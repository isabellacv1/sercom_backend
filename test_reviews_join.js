const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function run() {
  const profileId = "9baf141d-c907-46b2-b83f-0129e13ee7c5";

  // Test 1: Query without join
  const { data: raw, error: rawErr } = await supabase
    .from('reviews')
    .select('*')
    .or(`client_id.eq.${profileId},worker_id.eq.${profileId}`);
  console.log('Test 1 (no join):', JSON.stringify({ count: raw?.length, error: rawErr?.message }));

  // Test 2: Query with reviewer join (as used in backend)
  const { data: joined, error: joinErr } = await supabase
    .from('reviews')
    .select(`*, reviewer:profiles!reviewer_id(full_name, profile_image_url)`)
    .or(`client_id.eq.${profileId},worker_id.eq.${profileId}`);
  console.log('Test 2 (with join):', JSON.stringify({ count: joined?.length, error: joinErr?.message }));
  if (joined?.length > 0) console.log('First review:', JSON.stringify(joined[0], null, 2));

  // Test 3: Try alternate join alias
  const { data: alt, error: altErr } = await supabase
    .from('reviews')
    .select(`*, profiles(full_name, profile_image_url)`)
    .or(`client_id.eq.${profileId},worker_id.eq.${profileId}`);
  console.log('Test 3 (alt join):', JSON.stringify({ count: alt?.length, error: altErr?.message }));
}
run();
