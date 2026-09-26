import { getJSON, setJSON, json, store } from './_store.mjs';
import { requireUser, authError, adminOnly, superOnly, notify, publicUser } from './_auth.mjs';

const clean = (v, max = 8000) => String(v ?? '').trim().slice(0, max);

export default async (req) => {
  const user = await requireUser(req);
  if (!user) return authError();
  if (!adminOnly(user)) return json({ error: 'Admin permission required.' }, 403);
  try {
    if (req.method === 'GET') {
      const system = await getJSON('system:config', {});
      const url = new URL(req.url);
      const q = clean(url.searchParams.get('q'), 200).toLowerCase();
      const users = [];
      const listed = await store().list({ prefix: 'user:' });
      for (const x of listed.blobs) {
        const u = await getJSON(x.key, null);
        if (!u) continue;
        const pu = publicUser(u);
        if (!q || [pu.accountId, pu.username, pu.name, pu.email, pu.phone].some(v => String(v || '').toLowerCase().includes(q))) users.push(pu);
      }
      const out = { success: true, system, users: users.sort((a,b) => String(a.createdAt||'').localeCompare(String(b.createdAt||''))) };
      if (user.role === 'SUPER_ADMIN') {
        const posts = [];
        const listedPosts = await store().list({ prefix: 'doctor-super-post:' });
        for (const x of listedPosts.blobs) { const p = await getJSON(x.key, null); if (p) posts.push(p); }
        posts.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        out.doctorSuperPosts = posts.slice(0, 100);
      }
      return json(out);
    }
    if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
    const b = await req.json();

    if (b.action === 'promote') {
      if (!superOnly(user)) return json({ error: 'শুধু Super Admin অন্য user-কে Admin করতে পারবেন।' }, 403);
      const targetId = clean(b.accountId, 100).toUpperCase();
      const target = await getJSON(`user:${targetId}`, null);
      if (!target) return json({ error: 'Account ID পাওয়া যায়নি।' }, 404);
      if (target.role === 'SUPER_ADMIN') return json({ error: 'Super Admin-কে পরিবর্তন করা যাবে না।' }, 400);
      target.role = 'ADMIN'; target.updatedAt = new Date().toISOString();
      await setJSON(`user:${targetId}`, target);
      await notify(targetId, { type: 'ROLE_CHANGED', title: 'আপনাকে Admin করা হয়েছে', message: 'Super Admin আপনার account-কে Admin role দিয়েছেন।' });
      return json({ success: true, message: 'Account ID অনুযায়ী user-কে Admin করা হয়েছে।' });
    }

    if (b.action === 'demote') {
      if (!superOnly(user)) return json({ error: 'শুধু Super Admin Admin role পরিবর্তন করতে পারবেন।' }, 403);
      const targetId = clean(b.accountId, 100).toUpperCase();
      const target = await getJSON(`user:${targetId}`, null);
      if (!target || target.role !== 'ADMIN') return json({ error: 'Admin account পাওয়া যায়নি।' }, 404);
      target.role = 'USER'; target.updatedAt = new Date().toISOString();
      await setJSON(`user:${targetId}`, target);
      return json({ success: true, message: 'Admin role সরানো হয়েছে।' });
    }

    if (b.action === 'transfer_super') return json({ error: 'Super Admin transfer করা যাবে না।' }, 403);

    if (b.action === 'notice') {
      const title = clean(b.title, 150);
      const message = clean(b.message, 3000);
      const image = String(b.image || '');
      if (!title || !message) return json({ error: 'Notice title ও message দিন।' }, 400);
      if (image && (!image.startsWith('data:image/') || image.length > 3_500_000)) return json({ error: 'Notice image invalid বা খুব বড়।' }, 413);
      const notice = { id: `NOTICE-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, title, message, image, by: user.accountId, byName: user.name || user.username, createdAt: new Date().toISOString() };
      const notices = await getJSON('notices:global', []);
      notices.unshift(notice);
      await setJSON('notices:global', notices.slice(0, 100));
      // Keep notifications in sync so the notice also appears in the notification area.
      const listedUsers = await store().list({ prefix: 'user:' });
      for (const x of listedUsers.blobs) {
        const u = await getJSON(x.key, null);
        if (!u) continue;
        await notify(u.accountId, { type: 'NOTICE', title, message, image, noticeId: notice.id });
      }
      return json({ success: true, message: 'Notice প্রকাশ হয়েছে।' });
    }

    return json({ error: 'Invalid action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'Admin operation failed.' }, 500);
  }
};
