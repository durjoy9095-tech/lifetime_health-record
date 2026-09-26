import { getJSON, setJSON, json, store } from './_store.mjs';
import { requireUser, authError, notify } from './_auth.mjs';

const clean = (v, max = 8000) => String(v ?? '').trim().slice(0, max);
const validImage = (image) => !image || (image.startsWith('data:image/') && image.length <= 3_500_000);

export default async req => {
  const user = await requireUser(req);
  if (!user) return authError();
  try {
    if (req.method === 'GET') {
      const listed = await store().list({ prefix: 'doctor-post:' });
      const posts = [];
      for (const x of listed.blobs) { const p = await getJSON(x.key, null); if (p) posts.push(p); }
      posts.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return json({ success: true, posts: posts.slice(0, 100) });
    }
    if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
    if (user.accountType !== 'DOCTOR') return json({ error: 'শুধু Doctor post করতে পারবেন।' }, 403);
    const b = await req.json();
    const action = clean(b.action, 50);
    const text = clean(b.text, 5000);
    const image = String(b.image || '');
    if (!validImage(image)) return json({ error: 'Image invalid বা খুব বড়।' }, 413);

    if (action === 'create') {
      if (!text && !image) return json({ error: 'Post text বা image দিন।' }, 400);
      const post = { id: `POST-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`, doctorAccountId: user.accountId, doctorName: user.name || user.username, text, image, createdAt: new Date().toISOString() };
      await setJSON(`doctor-post:${post.id}`, post);
      return json({ success: true, message: 'Doctor post published.', post });
    }

    if (action === 'send_to_superadmin') {
      if (!text && !image) return json({ error: 'Message বা image দিন।' }, 400);
      const system = await getJSON('system:config', {});
      const superId = String(system.superAdminAccountId || '').trim().toUpperCase();
      if (!superId) return json({ error: 'Super Admin পাওয়া যায়নি।' }, 404);
      const post = { id: `DSP-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`, doctorAccountId: user.accountId, doctorName: user.name || user.username, text, image, createdAt: new Date().toISOString() };
      await setJSON(`doctor-super-post:${post.id}`, post);
      await notify(superId, { type: 'DOCTOR_PRIVATE_POST', title: 'নতুন Doctor Post', message: `${post.doctorName} আপনার কাছে একটি private post পাঠিয়েছেন।`, image, postId: post.id });
      return json({ success: true, message: 'Super Admin-এর কাছে Doctor post পাঠানো হয়েছে।' });
    }

    return json({ error: 'Invalid action' }, 400);
  } catch (e) { console.error(e); return json({ error: 'Post operation failed.' }, 500); }
};
