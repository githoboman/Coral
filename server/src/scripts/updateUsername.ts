
import "dotenv/config";
import getSupabaseClient from "../config/supabase.js";

const supabase = getSupabaseClient();

async function updateUsername() {
  const email = "mesalokubor63@gmail.com";
  const newUsername = "Ceeza";
  
  console.log(`Updating user ${email} to username: "${newUsername}"...`);

  const { data, error } = await supabase
    .from('user_profiles')
    .update({ username: newUsername })
    .eq('email', email)
    .select();

  if (error) {
    console.error("Error updating username:", error.message);
  } else if (data && data.length > 0) {
    console.log("✅ Successfully updated username.");
    console.log(JSON.stringify(data[0], null, 2));
  } else {
    console.log("❌ No user found with that email.");
  }
}

updateUsername().catch(console.error);
