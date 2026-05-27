const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function run() {
  const profileId = "9baf141d-c907-46b2-b83f-0129e13ee7c5";
  const { data, error } = await supabase
      .from('reviews')
      .select(`
        *,
        reviewer:profiles!reviewer_id(
          full_name,
          profile_image_url
        )
      `)
      .or(`client_id.eq.${profileId},worker_id.eq.${profileId}`)
      .neq('reviewer_id', profileId);
  console.log(JSON.stringify({ data, error }, null, 2));
}
run();
