// Public settings the browser needs. The anon key is designed to be public;
// row-level security in the database is what protects your data.
export default function handler(req, res) {
  const url = process.env.SUPABASE_URL, anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return res.status(500).json({ error: 'Server is missing SUPABASE_URL or SUPABASE_ANON_KEY' });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ url, anonKey });
}
