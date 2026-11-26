// Receives the existing harness's fresh loopback-only PostgreSQL clients.
// No env, hosted credentials, SDK, connection string or network creation here.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function proveCoreRollback({ t, admin, sql }) {
  assert.equal(admin.connectionParameters.host, '127.0.0.1');
  const before = await admin.query("select column_name from information_schema.columns where table_schema='public' and table_name='orders' order by column_name");
  const securitySnapshot = async () => ({
    policies: (await admin.query("select tablename,policyname,qual,with_check from pg_policies where schemaname='public' and tablename in('profiles','role_permissions','user_roles') order by tablename,policyname")).rows,
    authTrigger: (await admin.query("select pg_get_functiondef('public.handle_new_auth_user()'::regprocedure) definition")).rows,
    grants: (await admin.query("select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in('orders','inventory_balances','leads') order by table_name,grantee,privilege_type")).rows,
  });
  const beforeSecurity = await securitySnapshot();
  await t.test('core migration rollback removes finance, receipts and additive order columns atomically', async () => {
    await admin.query('BEGIN');
    try {
      await admin.query(sql);
      assert.equal((await admin.query("select to_regclass('public.finance_entries')::text as name")).rows[0].name, 'finance_entries');
      assert.equal((await admin.query("select to_regclass('momo_core_private.operation_receipts')::text as name")).rows[0].name, 'momo_core_private.operation_receipts');
    } finally { await admin.query('ROLLBACK'); }
    assert.equal((await admin.query("select to_regclass('public.finance_entries')::text as name")).rows[0].name, null);
    assert.deepEqual((await admin.query("select column_name from information_schema.columns where table_schema='public' and table_name='orders' order by column_name")).rows, before.rows);
    assert.equal((await admin.query("select to_regprocedure('public.core_create_order(jsonb)')::text as name")).rows[0].name, null);
    assert.deepEqual(await securitySnapshot(), beforeSecurity, 'rollback restores policies, grants and Auth trigger definition');
  });
}

export async function runCoreProductionChecks({ t, admin, actor, rpc, withRestoredDatabase }) {
  assert.equal(admin.connectionParameters.host, '127.0.0.1');
  const org = randomUUID(), foreignOrg = randomUUID();
  const owner = randomUUID(), operator = randomUUID(), reader = randomUUID(), foreign = randomUUID();
  const financeOnly = randomUUID(), reportsOnly = randomUUID();
  const forged = randomUUID(), ownCategory = randomUUID(), foreignCategory = randomUUID();
  let product, warehouse, firstOrder, foreignProduct, foreignWarehouse, foreignRole;
  let stock = 0;
  const count = async (table, where, params) => Number((await admin.query(`select count(*) n from ${table} where ${where}`, params)).rows[0].n);
  const call = (user, name, payload) => rpc(user, name, [payload]);
  const balance = async (id = product.id) => Number((await admin.query('select quantity from public.inventory_balances where warehouse_id=$1 and product_id=$2', [warehouse.id, id])).rows[0]?.quantity ?? 0);
  const denied = fn => assert.rejects(fn, error => ['42501', '23514', '22023', 'P0002'].includes(error.code));
  try {
    await admin.query('insert into public.organizations(id,name,slug) values($1,$2,$3),($4,$5,$6)', [org, 'Synthetic core A', 'core-'+org, foreignOrg, 'Synthetic core B', 'core-'+foreignOrg]);
    for (const [id, tenant] of [[owner,org],[operator,org],[reader,org],[foreign,foreignOrg],[financeOnly,org],[reportsOnly,org]]) {
      await admin.query('insert into auth.users(id,email,raw_app_meta_data,email_confirmed_at) values($1,$2,$3,now())', [id, `core-${id}@example.invalid`, JSON.stringify({organization_id:tenant})]);
    }
    for (const tenant of [org, foreignOrg]) await admin.query('select public.provision_default_roles($1)', [tenant]);
    for (const [id, tenant, role] of [[owner,org,'Admin'],[operator,org,'Operator'],[foreign,foreignOrg,'Admin']]) {
      await admin.query('insert into public.user_roles(user_id,role_id) select $1,id from public.roles where organization_id=$2 and name=$3', [id,tenant,role]);
    }
    const readRole = randomUUID();
    await admin.query("insert into public.roles(id,organization_id,name) values($1,$2,'Core reader')", [readRole,org]);
    for (const permission of ['dashboard.view','orders.read','leads.read','deliveries.read','products.read','inventory.read']) {
      await admin.query('insert into public.role_permissions(role_id,permission_code) values($1,$2)', [readRole,permission]);
    }
    await admin.query('insert into public.user_roles(user_id,role_id) values($1,$2)', [reader,readRole]);
    for (const [user,permission] of [[financeOnly,'finance.view'],[reportsOnly,'reports.view']]) {
      const role=randomUUID();await admin.query('insert into public.roles(id,organization_id,name) values($1,$2,$3)',[role,org,'Core '+permission]);
      await admin.query('insert into public.role_permissions(role_id,permission_code) values($1,$2)',[role,permission]);
      await admin.query('insert into public.user_roles(user_id,role_id) values($1,$2)',[user,role]);
    }
    foreignRole=(await admin.query("select id from public.roles where organization_id=$1 and name='Admin'",[foreignOrg])).rows[0].id;
    await admin.query("insert into public.categories(id,organization_id,name) values($1,$2,'Core category'),($3,$4,'Foreign category')",[ownCategory,org,foreignCategory,foreignOrg]);

    await t.test('Auth trigger ignores user-editable organization metadata and pending user cannot enter ERP', async () => {
      await admin.query('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,now())',[forged,`forged-${forged}@example.invalid`,JSON.stringify({organization_id:org})]);
      assert.equal((await admin.query('select organization_id from public.profiles where id=$1',[forged])).rows[0].organization_id,null);
      await denied(()=>rpc(forged,'core_dashboard_summary',[]));
    });
    await t.test('staff cannot self-change status, privileged email or tenant', async () => {
      await denied(()=>actor(reader,c=>c.query("update public.profiles set status='disabled' where id=$1",[reader])));
      await denied(()=>actor(reader,c=>c.query("update public.profiles set email='forged@example.invalid' where id=$1",[reader])));
      await denied(()=>actor(reader,c=>c.query('update public.profiles set organization_id=$1 where id=$2',[foreignOrg,reader])));
      const allowed=await actor(reader,c=>c.query("update public.profiles set first_name='Synthetic rename' where id=$1 returning first_name",[reader]));
      assert.equal(allowed.rows[0].first_name,'Synthetic rename');
    });
    await t.test('organization manager cannot read/write foreign role grants or cross-tenant memberships',async()=>{
      assert.equal((await actor(owner,c=>c.query('select * from public.role_permissions where role_id=$1',[foreignRole]))).rowCount,0);
      await denied(()=>actor(owner,c=>c.query("insert into public.role_permissions(role_id,permission_code) values($1,'dashboard.view') on conflict do nothing",[foreignRole])));
      await denied(()=>actor(owner,c=>c.query('insert into public.user_roles(user_id,role_id) values($1,$2)',[reader,foreignRole])));
    });
    await t.test('product and warehouse CRUD RPCs derive org/actor and reject stale optimistic versions',async()=>{
      product=await call(owner,'core_save_product',{sku:'CORE-A',name:'Synthetic box',category_id:ownCategory,sale_price:100,discount_price:0,cost_price:40,is_active:true});
      warehouse=await call(owner,'core_save_warehouse',{name:'Synthetic warehouse',is_active:true});
      assert.equal(product.organization_id,org);assert.equal(product.created_by,owner);assert.equal(warehouse.organization_id,org);
      const updated=await call(owner,'core_save_product',{id:product.id,expected_updated_at:product.updated_at,sku:product.sku,name:'Synthetic box revised',category_id:ownCategory,sale_price:100,discount_price:0,cost_price:40,is_active:true});
      await assert.rejects(()=>call(owner,'core_save_product',{id:product.id,expected_updated_at:product.updated_at,sku:product.sku,name:'Stale',sale_price:1}),e=>e.code==='40001');
      product=updated;
      const changed=await call(owner,'core_save_warehouse',{id:warehouse.id,expected_updated_at:warehouse.updated_at,name:'Synthetic warehouse revised',is_active:true});
      await assert.rejects(()=>call(owner,'core_save_warehouse',{id:warehouse.id,expected_updated_at:warehouse.updated_at,name:'Stale'}),e=>e.code==='40001');
      warehouse=changed;
    });
    await t.test('order-only operator gets minimal active warehouse options without inventory read/cost rights',async()=>{
      assert.equal((await actor(operator,c=>c.query('select id from public.warehouses'))).rowCount,0);
      const options=await rpc(operator,'core_order_options',[]);
      assert.deepEqual(options,{source:'supabase',warehouses:[{id:warehouse.id,name:warehouse.name}]});
      await denied(()=>rpc(reader,'core_order_options',[]));
    });
    await t.test('same-org FK constraints reject known foreign product/category/warehouse IDs',async()=>{
      foreignProduct=await call(foreign,'core_save_product',{sku:'CORE-B',name:'Foreign synthetic box',sale_price:50,cost_price:20});
      foreignWarehouse=await call(foreign,'core_save_warehouse',{name:'Foreign synthetic warehouse'});
      await denied(()=>call(owner,'core_save_product',{sku:'INVALID',name:'Forbidden category',category_id:foreignCategory,sale_price:1}));
      await denied(()=>actor(owner,c=>c.query("insert into public.products(organization_id,category_id,sku,name) values($1,$2,'RAW-FOREIGN','Blocked')",[org,foreignCategory])));
      await denied(()=>call(owner,'core_adjust_inventory',{request_id:randomUUID(),warehouse_id:foreignWarehouse.id,product_id:product.id,quantity_delta:1,movement_type:'income'}));
    });
    await t.test('four concurrent inventory retries add stock and movement exactly once',async()=>{
      const payload={request_id:randomUUID(),warehouse_id:warehouse.id,product_id:product.id,quantity_delta:10,movement_type:'income',note:'Synthetic opening'};
      const replies=await Promise.all(Array.from({length:4},()=>call(owner,'core_adjust_inventory',payload)));
      assert.ok(replies.every(r=>r.quantity===10));assert.equal(await balance(),10);stock=10;
      assert.equal(await count('public.inventory_movements','organization_id=$1 and product_id=$2',[org,product.id]),1);
      await assert.rejects(()=>call(owner,'core_adjust_inventory',{...payload,quantity_delta:20}),e=>e.code==='23505');
      await denied(()=>call(reader,'core_adjust_inventory',{...payload,request_id:randomUUID()}));
    });
    await t.test('four concurrent order retries reserve stock and create order/items/delivery/audit only once',async()=>{
      const payload={request_id:randomUUID(),warehouse_id:warehouse.id,customer_name:'Synthetic customer',phone:'99112233',delivery_address:'Synthetic test address',items:[{product_id:product.id,quantity:2}]};
      const replies=await Promise.all(Array.from({length:4},()=>call(operator,'core_create_order',payload)));
      assert.equal(new Set(replies.map(r=>r.id)).size,1);firstOrder=replies[0];
      assert.equal(firstOrder.product_total,200);assert.equal(firstOrder.collect_amount,200);assert.equal(firstOrder.organization_id,org);
      assert.equal(await balance(),stock-2);stock-=2;
      assert.equal(await count('public.orders','organization_id=$1',[org]),1);
      assert.equal(await count('public.order_items','order_id=$1',[firstOrder.id]),1);
      assert.equal(await count('public.deliveries','order_id=$1',[firstOrder.id]),1);
      assert.equal(await count('public.audit_logs',"organization_id=$1 and action='core.order.create'",[org]),1);
      await denied(()=>rpc(operator,'core_update_order',[firstOrder.id,{status:'delivered',expected_updated_at:firstOrder.updated_at}]));
      await denied(()=>rpc(operator,'core_update_order',[firstOrder.id,{status:'in_transit',expected_updated_at:firstOrder.updated_at}]));
      await denied(()=>call(operator,'core_create_order',{...payload,request_id:randomUUID(),product_total:1}));
      await denied(()=>call(operator,'core_create_order',{...payload,request_id:randomUUID(),organization_id:foreignOrg}));
      await denied(()=>call(operator,'core_create_order',{...payload,request_id:randomUUID(),is_demo:true}));
      await denied(()=>call(operator,'core_create_order',{...payload,request_id:randomUUID(),items:[{product_id:foreignProduct.id,quantity:1}]}));
    });
    await t.test('insufficient stock rolls back the entire order transaction without orphan rows',async()=>{
      const before=await count('public.orders','organization_id=$1',[org]);
      await denied(()=>call(operator,'core_create_order',{request_id:randomUUID(),warehouse_id:warehouse.id,customer_name:'Synthetic',phone:'99112233',delivery_address:'Synthetic',items:[{product_id:product.id,quantity:100}]}));
      assert.equal(await count('public.orders','organization_id=$1',[org]),before);assert.equal(await balance(),stock);
      assert.equal(await count('momo_core_private.operation_receipts',"organization_id=$1 and operation='order.create'",[org]),1);
    });
    await t.test('two concurrent orders cannot oversell the same stock',async()=>{
      const limited=await call(owner,'core_save_product',{sku:'CORE-LIMITED',name:'Synthetic limited',sale_price:10});
      await call(owner,'core_adjust_inventory',{request_id:randomUUID(),warehouse_id:warehouse.id,product_id:limited.id,quantity_delta:3,movement_type:'income'});
      const payload={warehouse_id:warehouse.id,customer_name:'Synthetic',phone:'99112233',delivery_address:'Synthetic',items:[{product_id:limited.id,quantity:2}]};
      const results=await Promise.allSettled(Array.from({length:2},()=>call(operator,'core_create_order',{...payload,request_id:randomUUID()})));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'23514');
      assert.equal(await balance(limited.id),1);
    });
    await t.test('cancellation requires permission, restores reservation once, and stale retry cannot restock',async()=>{
      await denied(()=>rpc(operator,'core_update_order',[firstOrder.id,{status:'cancelled',expected_updated_at:firstOrder.updated_at}]));
      const cancelled=await rpc(owner,'core_update_order',[firstOrder.id,{status:'cancelled',expected_updated_at:firstOrder.updated_at}]);
      assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.reservation_released,true);stock+=2;assert.equal(await balance(),stock);
      await assert.rejects(()=>rpc(owner,'core_update_order',[firstOrder.id,{status:'cancelled',expected_updated_at:firstOrder.updated_at}]),e=>e.code==='40001');
      const again=await rpc(owner,'core_update_order',[firstOrder.id,{status:'cancelled',expected_updated_at:cancelled.updated_at}]);assert.equal(await balance(),stock);
      await denied(()=>rpc(owner,'core_update_order',[firstOrder.id,{status:'new',expected_updated_at:again.updated_at}]));
    });
    await t.test('lead creation/call logging/conversion persist atomically and cannot convert twice',async()=>{
      const payload={request_id:randomUUID(),product_id:product.id,contacts:[{customer_name:'Synthetic lead',phone:'+97699112233',comment:'Synthetic only'}]};
      const leads=await call(operator,'core_create_leads',payload),replay=await call(operator,'core_create_leads',payload);
      assert.equal(leads[0].id,replay[0].id);assert.equal(leads[0].phone_normalized,'99112233');
      let lead=await rpc(operator,'core_update_lead',[leads[0].id,{status:'follow_up',record_call:true,note:'Synthetic call',expected_updated_at:leads[0].updated_at}]);
      assert.equal(lead.call_attempts,1);assert.equal(await count('public.call_logs','lead_id=$1',[lead.id]),1);
      const order=await call(operator,'core_create_order',{request_id:randomUUID(),lead_id:lead.id,warehouse_id:warehouse.id,customer_name:lead.customer_name,phone:lead.phone,delivery_address:'Synthetic',items:[{product_id:product.id,quantity:1}]});stock--;
      const persisted=(await admin.query('select * from public.leads where id=$1',[lead.id])).rows[0];assert.equal(persisted.status,'converted');assert.equal(persisted.converted_order_id,order.id);
      await denied(()=>rpc(operator,'core_update_lead',[lead.id,{status:'follow_up',record_call:true,expected_updated_at:lead.updated_at}]));
      await assert.rejects(()=>call(operator,'core_create_order',{request_id:randomUUID(),lead_id:lead.id,warehouse_id:warehouse.id,customer_name:'Synthetic',phone:lead.phone,delivery_address:'Synthetic',items:[{product_id:product.id,quantity:1}]}),e=>e.code==='23505');
      firstOrder=order;
    });
    await t.test('delivery uses optimistic lock, rejects foreign courier and updates delivered order state',async()=>{
      const delivery=(await admin.query('select to_jsonb(d) value from public.deliveries d where order_id=$1',[firstOrder.id])).rows[0].value;
      await denied(()=>rpc(owner,'core_update_delivery',[firstOrder.id,{status:'assigned',courier_id:foreign,expected_updated_at:delivery.updated_at}]));
      const result=await rpc(owner,'core_update_delivery',[firstOrder.id,{status:'delivered',courier_id:owner,expected_updated_at:delivery.updated_at}]);
      assert.equal(result.status,'delivered');assert.ok(result.delivered_at);
      const row=(await admin.query('select * from public.orders where id=$1',[firstOrder.id])).rows[0];assert.equal(row.status,'delivered');assert.ok(row.delivered_at);
      await assert.rejects(()=>rpc(owner,'core_update_delivery',[firstOrder.id,{status:'failed',expected_updated_at:delivery.updated_at}]),e=>e.code==='40001');
    });
    await t.test('cash ledger uses named finance permission and stable idempotency without duplicate income',async()=>{
      const payload={request_id:randomUUID(),entry_type:'income',amount:80,description:'Synthetic payment',order_id:firstOrder.id};
      const replies=await Promise.all(Array.from({length:4},()=>call(owner,'core_record_finance',payload)));
      assert.equal(new Set(replies.map(r=>r.id)).size,1);assert.equal(await count('public.finance_entries','organization_id=$1',[org]),1);
      await call(owner,'core_record_finance',{request_id:randomUUID(),entry_type:'expense',amount:20,description:'Synthetic cost'});
      await denied(()=>call(reader,'core_record_finance',{...payload,request_id:randomUUID()}));
      assert.equal((await actor(reader,c=>c.query('select * from public.finance_entries'))).rowCount,0);
    });
    await t.test('NaN money cannot corrupt product valuation or cashflow',async()=>{
      await denied(()=>call(owner,'core_save_product',{sku:'CORE-NAN',name:'Invalid money',sale_price:'NaN'}));
      await denied(()=>call(owner,'core_record_finance',{request_id:randomUUID(),entry_type:'income',amount:'NaN',description:'Invalid money'}));
      assert.equal(await count('public.products',"organization_id=$1 and sku='CORE-NAN'",[org]),0);
    });
    await t.test('dashboard derives real totals, excludes marked demo rows, and separates cashflow from revenue',async()=>{
      const before=await rpc(owner,'core_dashboard_summary',[]);
      assert.equal(before.source,'supabase');assert.equal(before.today.deliveredRevenue,100);assert.equal(before.finance.income,80);assert.equal(before.finance.expense,20);assert.equal(before.finance.netCashflow,60);assert.equal(before.finance.receivable,20);
      await admin.query("insert into public.orders(organization_id,customer_name,phone,phone_normalized,delivery_address,status,product_total,collect_amount,is_demo) values($1,'Synthetic demo','99112233','99112233','Synthetic','delivered',999999,999999,true)",[org]);
      await admin.query("insert into public.finance_entries(organization_id,entry_type,amount,description,is_demo,created_by) values($1,'income',999999,'Synthetic demo',true,$2)",[org,owner]);
      const after=await rpc(owner,'core_dashboard_summary',[]);assert.deepEqual(after,before);
      const restricted=await rpc(reader,'core_dashboard_summary',[]);assert.equal(restricted.finance,null);assert.equal(restricted.inventory.stockCost,null);
      const foreignSummary=await rpc(foreign,'core_dashboard_summary',[]);assert.equal(foreignSummary.today.orders,0);assert.equal(foreignSummary.finance.income,0);
      const base=await actor(foreign,c=>c.query('select id from public.orders where organization_id=$1',[org]));assert.equal(base.rowCount,0);
    });
    await t.test('finance-only and reports-only roles receive only their authorized aggregate sections',async()=>{
      const finance=await rpc(financeOnly,'core_dashboard_summary',[]);
      assert.equal(finance.today,null);assert.deepEqual(finance.dailySales,[]);assert.deepEqual(finance.statusCounts,{});assert.equal(finance.inventory,null);
      assert.equal(finance.finance.income,80);assert.equal(finance.finance.netCashflow,60);
      const reports=await rpc(reportsOnly,'core_dashboard_summary',[]);
      assert.equal(reports.today.deliveredRevenue,100);assert.equal(reports.finance,null);assert.equal(reports.inventory,null);
      assert.equal((await actor(financeOnly,c=>c.query('select id from public.orders'))).rowCount,0);
      assert.equal((await actor(reportsOnly,c=>c.query('select id from public.orders'))).rowCount,0);
    });
    await t.test('raw stock/order/cash writes and private helpers are inaccessible even with users.manage',async()=>{
      await denied(()=>actor(owner,c=>c.query('update public.inventory_balances set quantity=999 where product_id=$1',[product.id])));
      await denied(()=>actor(owner,c=>c.query('delete from public.orders where id=$1',[firstOrder.id])));
      await denied(()=>actor(owner,c=>c.query("insert into public.finance_entries(organization_id,entry_type,amount,description,created_by) values($1,'income',1,'Forged',$2)",[org,owner])));
      await denied(()=>actor(owner,c=>c.query("select momo_core_private.require_permission('orders.create')")));
      assert.equal((await admin.query("select has_function_privilege('anon','public.core_create_order(jsonb)','execute') allowed")).rows[0].allowed,false);
      assert.equal((await admin.query("select has_function_privilege('authenticated','public.handle_new_auth_user()','execute') allowed")).rows[0].allowed,false);
    });
    await t.test('full core backup restores synthetic order, inventory, cash, audit and idempotency into a fresh DB',{skip:!withRestoredDatabase},async()=>{
      const snapshot=async client=>({
        rows: await Promise.all(['orders','order_items','finance_entries','inventory_balances','inventory_movements','audit_logs'].map(async table=>[table,(await client.query(`select to_jsonb(x) row from public.${table} x where organization_id=$1 order by to_jsonb(x)::text`,[org])).rows])),
        receipts:(await client.query('select to_jsonb(x) row from momo_core_private.operation_receipts x where organization_id=$1 order by to_jsonb(x)::text',[org])).rows,
        procedure:(await client.query("select pg_get_functiondef('public.core_create_order(jsonb)'::regprocedure) definition")).rows,
        privileges:(await client.query("select has_table_privilege('authenticated','public.finance_entries','insert') cash_write,has_table_privilege('authenticated','public.inventory_balances','update') stock_write,has_function_privilege('anon','public.core_create_order(jsonb)','execute') anon_rpc")).rows,
      });
      const source=await snapshot(admin);
      await withRestoredDatabase(async restored=>{
        assert.deepEqual(await snapshot(restored),source);
        assert.equal((await restored.query('select count(*)::int n from public.orders where organization_id=$1',[org])).rows[0].n,4);
      });
    });
    await t.test('disabled actor loses core read/mutation and cannot self-reactivate',async()=>{
      await admin.query("update public.profiles set status='disabled' where id=$1",[reader]);
      await denied(()=>rpc(reader,'core_dashboard_summary',[]));
      const unchanged=await actor(reader,c=>c.query("update public.profiles set status='active' where id=$1 returning id",[reader]));
      assert.equal(unchanged.rowCount,0);
      assert.equal((await admin.query('select status from public.profiles where id=$1',[reader])).rows[0].status,'disabled');
      assert.equal((await actor(reader,c=>c.query('select id from public.orders'))).rowCount,0);
    });
  } finally {
    // Only this fresh synthetic organization, never a real customer/tenant.
    for (const table of ['finance_entries','order_status_history','deliveries','order_items','inventory_movements','inventory_balances','call_logs']) await admin.query(`delete from public.${table} where organization_id=any($1::uuid[])`,[[org,foreignOrg]]);
    await admin.query('delete from public.orders where organization_id=any($1::uuid[])',[[org,foreignOrg]]);
    await admin.query('delete from public.leads where organization_id=any($1::uuid[])',[[org,foreignOrg]]);
    await admin.query('delete from public.audit_logs where organization_id=any($1::uuid[])',[[org,foreignOrg]]);
    await admin.query('delete from momo_core_private.operation_receipts where organization_id=any($1::uuid[])',[[org,foreignOrg]]);
    await admin.query('delete from auth.users where id=any($1::uuid[])',[[owner,operator,reader,foreign,forged,financeOnly,reportsOnly]]);
    await admin.query('delete from public.organizations where id=any($1::uuid[])',[[org,foreignOrg]]);
    await t.test('core synthetic fixture cleanup leaves no core tenant, auth user, cash, receipt or audit rows',async()=>{
      assert.equal(await count('public.organizations','id=any($1::uuid[])',[[org,foreignOrg]]),0);
      assert.equal(await count('auth.users','id=any($1::uuid[])',[[owner,operator,reader,foreign,forged,financeOnly,reportsOnly]]),0);
      assert.equal(await count('momo_core_private.operation_receipts','organization_id=any($1::uuid[])',[[org,foreignOrg]]),0);
    });
  }
}
