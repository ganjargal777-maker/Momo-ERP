# MOMO ERP — үндсэн өгөгдлийн contract

2026-11-26. Энэ баримт isolated local source болон local тестийн хүрээтэй. Production migration/deployment, бодит хэрэглэгчийн login/CRUD энэ баримтаар PASS болоогүй. Production өгөгдөл хуулж тестлээгүй.

## Frontend бүтэц

- `dist/core-service.js`: authenticated Supabase client, organization-scoped permission-aware reads, typed RPC payload, sanitized errors.
- `dist/core-ui.js`: бодит data snapshot → dashboard/order/lead/product/inventory/delivery/cashflow/reports/customer UI. Role/user management-ийн existing RPC хэвээр.
- `dist/app.js`: navigation, form shells, role/user UI. Operational seed, local storage fallback, static catalog fetch хассан. `momo:core-ready` event нь real data UI-г эхлүүлнэ. Operational modules-ийн хуучин coming-soon blocker хассан; Social/AI menu хэвээр.
- `dist/index.html`: анхны дүн `—`/empty; fake sales/trends/courier/map/customer count байхгүй. Core scripts auth-аас өмнө ачаална; Supabase browser SDK 2.112.3-д pin хийсэн.

`core-service` нь `window.nexerpAuth.client`, `profile.organizationId`, `can(permission)` хэрэглэнэ. Service-role/Bearer/Meta token frontend-д нэмээгүй. Frontend permission нь affordance; серверийн RPC/RLS эцсийн authorization хийнэ.

## Read ба бодит тооцоо

| UI | Эх сурвалж | Permission |
| --- | --- | --- |
| Бараа/ангилал | `products`, `categories` | `products.read` |
| Нөөц/агуулах | `warehouses`, `inventory_balances`, `inventory_movements` | `inventory.read` |
| Каталог дахь барааны нийт үлдэгдэл | `core_product_stock(product_ids)` нь хүссэн идэвхтэй бараа бүрийн бүх агуулахын үлдэгдлийг нийлбэрлэнэ. RPC алдаа эсвэл үр дүнд тухайн бараа байхгүй бол үлдэгдэл тодорхойгүй гэж харуулна. | `products.read` + `inventory.read` |
| Захиалга | `orders`, nested `order_items`/product name/SKU | `orders.read` |
| Дугаар/залгалт | `leads`, `call_logs` | `leads.read` |
| Хүргэлт | `deliveries` | `deliveries.read` |
| Page сонголт | `facebook_pages`-ийн зөвхөн safe public metadata | `pages.read` |
| Мөнгөн урсгал | `finance_entries` | `finance.view` |
| Нийлбэр | `core_dashboard_summary()` | Dashboard/report/finance-ийн серверийн gate, module-level redaction |
| Захиалгын агуулахын сонголт | `core_order_options()` → `{source,warehouses:[{id,name}]}` | `orders.create`, inventory balance/cost агуулахгүй |

Read бүрт `organization_id` explicit filter, orders/leads/finance-д `is_demo=false` өгнө. RLS давхар шалгана. Social-ийн шинэ хүснэгтүүдийг core data load заавал шаардахгүй. Page credential_reference/token column select хийхгүй.

Каталог нь тухайн байгууллагын идэвхтэй барааг серверээс 24-өөр хуудаслаж, нэр болон ID-аар эрэмбэлнэ. Нэр, SKU хайлт болон ангиллын шүүлтийг хуудаслахаас өмнө хэрэглэнэ. Харагдах тоо нь шүүлтэд таарсан бүх барааны тоо. Захиалга, дугаарын маягт хоёр ба түүнээс олон тэмдэгтээр тухайн байгууллагын бүх идэвхтэй барааны нэр, SKU-г серверээс хайж, эхний 30 үр дүнг харуулна. Нөөцийн хөдөлгөөний маягт мөн идэвхтэй каталогоос хайна. Захиалгын CSV нь orders.read эрхээр тухайн байгууллагын is_demo=false захиалгыг order_number буурах дарааллаар, 500 хүртэл мөрөөр үргэлжлүүлэн уншина. Эхний хүсэлтийн мөрийн тоогоор бүрэн эсэхийг шалгаад файл үүсгэнэ. Унших явцад өөрчлөгдсөн төлөв тухайн хуудсыг татсан үеийн утгатай байна. Хүргэлтийн CSV нь deliveries.read эрхээр тухайн байгууллагын демо бус захиалгатай холбогдсон хүргэлтүүдийг order_id буурах дарааллаар 500 хүртэл мөрөөр уншина. Файлд захиалгын ID, хүргэлтийн төлөв, хүргэгчийн ID ба хүргэсэн хугацаа орно. Мөнгөн урсгалын CSV нь `finance.view` эрхээр тухайн байгууллагын `is_demo=false` гүйлгээг болсон хугацаагаар нь буурахаар, ижил хугацаатай бол ID буурахаар эрэмбэлж бүрэн татна. Хуудас бүр унших үеийн өгөгдлийг харуулна. Бусад дэлгэрэнгүй жагсаалт болон үлдэгдлийн CSV тус бүр 500 хүртэл мөртэй. Нийлбэрийг серверийн RPC бүх зөвшөөрөгдсөн үндсэн өгөгдлөөр тооцно. Уншихад алдаа гарвал тухайн мэдээллийг тодорхойгүй гэж харуулна.

Dashboard борлуулалт нь хүргэгдсэн захиалгын барааны дүн. Мөнгөн орлого нь `finance_entries`-д ажилтан бүртгэсэн collection. Хоёрыг давхар нэмж орлого гэж тооцохгүй. Санхүүгийн `income − expense`-г **цэвэр мөнгөн урсгал** гэж нэрлэнэ; цэвэр ашиг/татвар/элэгдэл/бүрэн double-entry accounting гэж тайлагнахгүй. Receivable нь хүргэгдсэн захиалгын collection due-аас холбоотой income-ийг хассан серверийн тооцоо.

## Mutation RPC

Actor, organization болон permission нь session/RLS/RPC-ээс; caller `organization_id`, `actor_id`, `unit_price`, `product_total`, `is_demo` илгээхгүй.

| RPC | Аргумент | Үр дүн |
| --- | --- | --- |
| `core_save_product` | `{payload:{id?,sku,name,category_id?,sale_price,discount_price,cost_price,is_active,expected_updated_at?}}` | Product row; stock өөрчилдөггүй |
| `core_save_warehouse` | `{payload:{id?,name,branch_id?,is_active,expected_updated_at?}}` | Warehouse row |
| `core_adjust_inventory` | `{payload:{request_id,warehouse_id,product_id,quantity_delta,movement_type,note}}` | Atomic balance + movement; same operation retry idempotent |
| `core_create_order` | Доорх JSON | Atomic order/items/stock/movement/delivery/lead conversion |
| `core_update_order` | `{target_order,payload:{status,note,expected_updated_at}}` | Order row; cancel stock нэг удаа буцаана |
| `core_create_leads` | `{payload:{request_id,facebook_page_id?,product_id?,contacts:[{customer_name,phone,comment}]}}` | Lead rows |
| `core_update_lead` | `{target_lead,payload:{status,record_call,note,expected_updated_at}}` | Lead row, шаардлагатай call log |
| `core_update_delivery` | `{target_order,payload:{status,courier_id?,note,expected_updated_at}}` | Delivery row; terminal/organization guard |
| `core_record_finance` | `{payload:{request_id,entry_type,amount,description,order_id?,occurred_at?}}` | Explicit append-only cash entry |

```json
{
  "payload": {
    "request_id": "10000000-0000-4000-8000-000000000004",
    "customer_name": "Зохиомол хэрэглэгч",
    "phone": "99112233",
    "delivery_address": "Зохиомол тестийн хаяг",
    "facebook_page_id": null,
    "lead_id": null,
    "branch_id": null,
    "warehouse_id": "10000000-0000-4000-8000-000000000003",
    "items": [
      {"product_id": "10000000-0000-4000-8000-000000000002", "quantity": 2}
    ],
    "collect_amount": 1200,
    "note": "Local synthetic жишээ; бодит захиалга биш"
  }
}
```

Үнэ, идэвхтэй product, warehouse болон хүрэлцэх үлдэгдлийг сервер дахин шалгана. `discount_price` нь эерэг бөгөөд `sale_price`-аас бага үед орлуулах үнэ; хасах discount delta биш. Collection amount нь server product total-оос хэтрэхгүй.

`expected_updated_at`-ийг database-аас ирсэн **яг тэр string**, microseconds-тэй нь буцаана. `Date.toISOString()`-аар хувиргаж precision алдахгүй. Order status: `new/preparing/in_transit/delivered/cancelled`; delivered/cancelled terminal. Lead converted төлөвийг зүгээр dropdown-оор үүсгэхгүй, бодит order RPC хийх ёстой. Delivery status: `pending/assigned/in_transit/delivered/failed/returned`.

Form submit pending үед давхар submit хаана; `request_id` тухайн нээлттэй form-д тогтвортой. Network uncertainty дээр шинэ key үүсгэн blind retry хийхгүй. Browser restart/өөр төхөөрөмжийн шинэ form-оор үүсгэх ажиллагааны байгууллагын duplicate/reconciliation бодлогыг production acceptance-д тусад нь батална; local form guard-ийг бүх системийн exactly-once гэж тайлагнахгүй.

## Хүний ажлын урсгал

1. Бараа, идэвхтэй агуулах үүсгэнэ. Нөөцийг product edit-д overwrite хийхгүй, inventory movement-ээр оруулна.
2. Дугаар үүсгэх эсвэл шууд шинэ order form нээнэ. Product UUID, warehouse UUID, customer phone/address-ийг ажилтан сонгож шалгана.
3. Сервер transaction амжилттай болсон үед л амжилт toast гаргана. Failure дээр modal хаахгүй, form key хэвээр үлдэнэ.
4. Хүргэлтийн төлөвийг RPC-ээр шинэчилнэ. Fake courier, route, ETA болон GPS map байхгүй.
5. Бодитоор хүлээн авсан collection/expense-ийг cash entry болгон тусад нь бүртгэнэ. Order delivered болсон нь cash received гэсэн үг биш.

Product delete-ийн оронд inactive, order delete-ийн оронд cancel хэрэглэнэ; production data устгахгүй. Хуучин бодит database дотор demo-like мөр байгаа эсэхийг нэр/дүнгээр таамаглаж өөрчлөхгүй. Source demo arrays/cache нь server рүү импортлогдохгүй; existing row classification нь тусдаа review.

## Local тест ба production gate

`node --test test/core-service.test.mjs`: **14 PASS**, 0 fail/skip. Auth context, permission-aware no-query, organization/demo filters, safe Page metadata, order warehouse options, source-derived unknown/error state, typed order/stock/lead/cash payload, exact concurrency timestamp, stable retry key, no operational seed fallback шалгасан. Бүх read query-ийн sort column-ийг бодит SQL table definition-тэй тулгана: `call_logs.called_at`, `inventory_balances.updated_at`, бусад `created_at`.

SQL/RLS/atomic concurrency-ийн бодит нотолгоог core PostgreSQL integration suite; browser form-to-database нотолгоог browser acceptance suite-ээс авна. Энэ 14 test нь hosted CRUD/Auth/Meta delivery-ийн орлуулагч биш. Production-д core migration + permission review + backup/restore/rollback + auth/browser acceptance баталгаажсаны дараа frontend deploy хийнэ. RPC/column байхгүй production дээр frontend error-ийг demo data-аар нуухгүй.

ERP–Messenger Phase 6B payload нь **review draft**. ProductReference/text-ийг product UUID гэж итгэхгүй, үнэ/үлдэгдэл зохиохгүй, warehouse-ийг автоматаар сонгохгүй. Employee authorization болон verification-ий дараа л шинэ core order payload үүсгэнэ; bot callback/auto-send энэ frontend өөрчлөлтийн хэсэг биш.
