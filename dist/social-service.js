(() => {
  const fail = (label, error) => {
    if (!error) return;
    const message = error.message || error.details || String(error);
    throw new Error(`${label}: ${message}`);
  };
  const one = (result, label) => { fail(label, result.error); return result.data; };

  class SocialSupabaseService {
    constructor(auth) {
      this.auth = auth;
      this.client = auth.client;
      this.organizationId = auth.profile.organizationId;
      this.userId = auth.profile.id;
    }

    async invokeSocial(body) {
      // Use the authenticated SDK directly: the older auth helper flattens
      // structured upstream failures into "[object Object]".
      const { data, error } = await this.client.functions.invoke('social-integration', { body });
      let envelope = data;
      if (error?.context && typeof error.context.clone === 'function') {
        try { envelope = await error.context.clone().json(); } catch { /* Generic transport error below. */ }
      }
      if (error || !envelope || envelope.ok !== true) {
        const detail = envelope?.error;
        const failure = new Error(typeof detail === 'object' && typeof detail?.message === 'string'
          ? detail.message : typeof detail === 'string' ? detail : 'Сошиал үйлчилгээтэй холбогдож чадсангүй.');
        failure.code = detail?.code || 'social_request_failed';
        failure.status = error?.context?.status || detail?.upstreamStatus || 0;
        failure.requestId = detail?.requestId || envelope?.requestId || null;
        failure.retryAfter = detail?.retryAfter;
        failure.upstreamStatus = detail?.upstreamStatus;
        failure.outcomeUnknown = detail?.outcomeUnknown === true;
        failure.operationId = detail?.operationId || null;
        throw failure;
      }
      return envelope;
    }

    async loadWorkspace() {
      const canListPages = this.auth.can('pages.read') || this.auth.can('social_inbox.read');
      const [pages, teams, members, pageTeams, access, presence, profiles, conversations, replies, knowledge, flags] = await Promise.all([
        canListPages ? this.client.rpc('list_social_page_registry') : Promise.resolve({ data: [], error: null }),
        this.client.from('social_teams').select('*').order('name'),
        this.client.from('social_team_members').select('*'),
        this.client.from('social_page_teams').select('*').order('priority'),
        this.client.from('social_page_user_access').select('*'),
        this.client.from('social_agent_presence').select('*'),
        this.client.from('profiles').select('id,first_name,last_name,email,status').eq('status', 'active').order('first_name'),
        this.client.from('social_conversation_assignments').select('*').order('last_activity_at', { ascending: false }),
        this.client.from('social_saved_replies').select('*').order('updated_at', { ascending: false }),
        this.client.from('social_knowledge_entries').select('*').eq('is_active', true).order('updated_at', { ascending: false }),
        this.client.from('feature_flags').select('key,enabled').in('key', ['momo_ai_ui', 'social_inbox_ui'])
      ]);
      for (const [label, result] of Object.entries({ pages, teams, members, pageTeams, access, presence, profiles, conversations, replies, knowledge, flags })) fail(label, result.error);
      const profileMap = new Map(profiles.data.map(p => [p.id, p]));
      const displayName = id => { const p = profileMap.get(id); return p ? [p.last_name, p.first_name].filter(Boolean).join(' ') || p.email : ''; };
      return {
        pages: pages.data.map(p => ({ ...p,
          primary: pageTeams.data.find(x => x.page_id === p.id && x.assignment_type === 'primary')?.team_id || null,
          backup: pageTeams.data.find(x => x.page_id === p.id && x.assignment_type === 'backup')?.team_id || null,
          teamLinks: pageTeams.data.filter(x => x.page_id === p.id).map(x => ({ team_id: x.team_id, assignment_type: x.assignment_type, priority: x.priority })),
          teamIds: [...new Set(pageTeams.data.filter(x => x.page_id === p.id).map(x => x.team_id))],
          access: access.data.filter(x => x.page_id === p.id)
        })),
        teams: teams.data.map(t => ({ ...t, leader: displayName(t.leader_id), members: members.data.filter(x => x.team_id === t.id && x.is_active).map(x => x.user_id) })),
        profiles: profiles.data,
        agents: presence.data.map(x => ({ id: x.user_id, name: displayName(x.user_id), status: x.status, load: x.active_conversations })),
        conversations: conversations.data,
        saved: replies.data,
        knowledge: knowledge.data,
        flags: Object.fromEntries(flags.data.map(flag => [flag.key, flag.enabled]))
      };
    }

    async savePage(input) {
      return one(await this.client.rpc('manage_social_page', {
        target_id: input.id || null, target_name: input.name, target_external_id: input.externalPageId || null,
        target_active: input.isActive !== false, target_connection_status: input.connectionStatus || 'disconnected',
        target_primary_team: input.primaryTeam || null, target_backup_team: input.backupTeam || null
      }), 'Page хадгалах');
    }

    async updatePresence(status) {
      if (!['online', 'offline', 'away', 'leave'].includes(status)) throw new Error('Ажилтны төлөв буруу.');
      // Workload is maintained by atomic assignment RPCs, never by the browser.
      return one(await this.client.from('social_agent_presence').upsert({
        user_id: this.userId, organization_id: this.organizationId,
        status, updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' }).select().single(), 'Ажилтны төлөв шинэчлэх');
    }

    async saveTeam(input) {
      return one(await this.client.rpc('manage_social_team', {
        target_id: input.id || null, target_name: input.name, target_leader: input.leaderId || null,
        target_capacity: input.capacity || null, target_active: input.isActive !== false,
        target_members: input.memberIds || []
      }), 'Баг хадгалах');
    }

    async savePageAccess(pageId, userId, permissions) {
      return one(await this.client.rpc('set_social_page_user_access', {
        target_page: pageId, target_user: userId, target_read: !!permissions.read,
        target_reply: !!permissions.reply, target_assign: !!permissions.assign
      }), 'Page эрх хадгалах');
    }

    async smartAssign(pageId, externalId) {
      return one(await this.client.rpc('smart_assign_social_conversation', { target_page: pageId, target_external_id: externalId }), 'Smart assignment');
    }

    async updateConversation(conversation, action, teamId = null, assigneeId = null) {
      return one(await this.client.rpc('update_social_conversation', {
        target_assignment: conversation.id, expected_version: conversation.version,
        target_action: action, target_team: teamId, target_assignee: assigneeId
      }), 'Харилцаа шинэчлэх');
    }

    async createThread(title = 'Шинэ чат') {
      return one(await this.client.from('ai_threads').insert({ organization_id: this.organizationId, owner_id: this.userId, title }).select().single(), 'AI thread үүсгэх');
    }

    async listThreads() {
      return one(await this.client.from('ai_threads').select('*').order('updated_at', { ascending: false }), 'AI thread унших');
    }

    async listMessages(threadId) {
      return one(await this.client.from('ai_messages').select('*').eq('thread_id', threadId).order('created_at'), 'AI history унших');
    }

    async appendMessage(threadId, role, content, sources = []) {
      const message = one(await this.client.from('ai_messages').insert({ organization_id: this.organizationId, thread_id: threadId, role, content, sources, created_by: this.userId }).select().single(), 'AI message хадгалах');
      one(await this.client.from('ai_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId), 'AI thread шинэчлэх');
      return message;
    }

    async searchCatalog(query) {
      const q = String(query || '').trim().replace(/[%_,()]/g, ' ');
      if (q.length < 2) return [];
      const products = one(await this.client.from('products').select('id,sku,name,sale_price,discount_price,is_active').eq('is_active', true).or(`name.ilike.%${q}%,sku.ilike.%${q}%`).limit(8), 'Бараа хайх');
      if (!products.length) return [];
      const balances = one(await this.client.from('inventory_balances').select('product_id,quantity').in('product_id', products.map(x => x.id)), 'Үлдэгдэл унших');
      return products.map(product => ({ ...product, verifiedQuantity: balances.filter(x => x.product_id === product.id).reduce((sum, x) => sum + x.quantity, 0) }));
    }

    async saveReply(input) {
      const payload = { organization_id: this.organizationId, owner_id: this.userId, page_id: input.pageId || null, title: input.title, content: input.content, is_shared: !!input.shared };
      if (input.id) return one(await this.client.from('social_saved_replies').update(payload).eq('id', input.id).select().single(), 'Бэлэн хариулт шинэчлэх');
      return one(await this.client.from('social_saved_replies').insert(payload).select().single(), 'Бэлэн хариулт хадгалах');
    }

    async deleteReply(id) {
      one(await this.client.from('social_saved_replies').delete().eq('id', id), 'Бэлэн хариулт устгах');
    }

    async addKnowledge(input) {
      return one(await this.client.from('social_knowledge_entries').insert({
        organization_id: this.organizationId, page_id: input.pageId || null, title: input.title,
        answer: input.answer, source_reply_id: input.sourceReplyId || null, approved_by: this.userId
      }).select().single(), 'Knowledge base хадгалах');
    }
  }

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const selectionError = () => Object.assign(new Error('Page сонголт өөрчлөгдсөн.'), { code: 'selection_changed' });

  class SocialInboxSession {
    constructor({ invoke, storage, storageKey = 'momo-social-send-v1', randomUUID = () => crypto.randomUUID() }) {
      if (typeof invoke !== 'function') throw new Error('Social transport шаардлагатай.');
      this.invoke = invoke; this.storage = storage; this.storageKey = storageKey; this.randomUUID = randomUUID;
      this.pageId = null; this.resource = 'messenger'; this.generation = 0; this.inFlight = new Map();
    }

    selectPage(pageId, resource = 'messenger') {
      if (pageId !== null && !uuid.test(pageId)) throw new Error('ERP Page UUID сонгоно уу.');
      if (!['messenger', 'comment'].includes(resource)) throw new Error('Харилцааны төрөл буруу.');
      this.pageId = pageId; this.resource = resource; this.generation++;
    }

    async request(action, payload = {}) {
      if (!this.pageId) throw Object.assign(new Error('Эхлээд Page сонгоно уу.'), { code: 'page_required' });
      const generation = this.generation;
      try {
        const result = await this.invoke({ ...payload, action, pageId: this.pageId, resource: this.resource });
        if (generation !== this.generation) throw selectionError();
        if (result?.meta?.pageId && result.meta.pageId !== this.pageId) {
          throw Object.assign(new Error('Хариуны Page сонголт таарахгүй.'), { code: 'page_mapping_mismatch' });
        }
        return result;
      } catch (error) {
        if (generation !== this.generation) throw selectionError();
        throw error;
      }
    }

    sendReply(reply) {
      if (!this.pageId) return Promise.reject(Object.assign(new Error('Эхлээд Page сонгоно уу.'), { code: 'page_required' }));
      if (!reply || typeof reply.id !== 'string' || !Number.isSafeInteger(reply.version) || reply.version < 1) {
        return Promise.reject(new Error('Баталсан хариуны ID/хувилбар шаардлагатай.'));
      }
      const operation = JSON.stringify([this.pageId, this.resource, reply.id, reply.version]);
      if (this.inFlight.has(operation)) return this.inFlight.get(operation);
      let records, key;
      try {
        records = JSON.parse(this.storage?.getItem(this.storageKey) || '{}');
        if (!records || typeof records !== 'object' || Array.isArray(records)) throw new Error();
        key = records[operation];
        if (key !== undefined && (typeof key !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key))) throw new Error();
        if (!key) {
          key = 'ui-' + this.randomUUID();
          records[operation] = key;
          if (!this.storage || typeof this.storage.setItem !== 'function') throw new Error();
          this.storage.setItem(this.storageKey, JSON.stringify(records));
        }
      } catch {
        return Promise.reject(Object.assign(new Error('Илгээлтийн тогтвортой түлхүүрийг хадгалж чадсангүй. Browser storage-ийг шалгана уу.'), { code: 'send_storage_unavailable' }));
      }
      const pending = this.request('send', { reply: { id: reply.id, version: reply.version }, idempotencyKey: key });
      this.inFlight.set(operation, pending);
      pending.finally(() => { if (this.inFlight.get(operation) === pending) this.inFlight.delete(operation); }).catch(() => {});
      return pending;
    }

    async pollReply(id, { attempts = 6, delayMs = 1000, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), onUpdate = () => {} } = {}) {
      const generation = this.generation;
      let latest = null;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (generation !== this.generation) throw selectionError();
        const response = await this.request('reply', { id });
        latest = response.data;
        onUpdate(latest, response.meta || {});
        if (!['queued', 'sending'].includes(latest?.state)) return latest;
        if (attempt < attempts - 1) await wait(delayMs);
      }
      return latest;
    }
  }

  window.MomoSocialService = SocialSupabaseService;
  window.MomoSocialInboxSession = SocialInboxSession;
})();
