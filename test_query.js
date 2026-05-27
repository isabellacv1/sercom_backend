const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function run() {
  const { data, error } = await supabase.from('reviews').select('*');
  console.log(JSON.stringify({ data, error }, null, 2));
}
run();
