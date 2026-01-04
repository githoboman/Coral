// Test Supabase connection
import dotenv from 'dotenv';
import { getSupabaseClient } from './config/supabase';

dotenv.config();

async function testConnection() {
  console.log('Testing Supabase connection...');
  console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? '✓ Set' : '✗ Not set');
  console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? '✓ Set' : '✗ Not set');
  
  try {
    const supabase = getSupabaseClient();
    console.log('✓ Supabase client created');
    
    // Test query to user_profiles table
    const { data, error } = await supabase
      .from('user_profiles')
      .select('user_id')
      .limit(1);
    
    if (error) {
      console.error('✗ Database query failed:', error);
      process.exit(1);
    }
    
    console.log('✓ Database query successful');
    console.log('Sample data:', data);
    
    // Test query to tasks table
    const { data: tasksData, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .limit(1);
    
    if (tasksError) {
      console.error('✗ Tasks table query failed:', tasksError);
      process.exit(1);
    }
    
    console.log('✓ Tasks table accessible');
    
    // Test query to events table
    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('*')
      .limit(1);
    
    if (eventsError) {
      console.error('✗ Events table query failed:', eventsError);
      process.exit(1);
    }
    
    console.log('✓ Events table accessible');
    console.log('\n✓ All tests passed! Server should work correctly.');
    
  } catch (error) {
    console.error('✗ Connection test failed:', error);
    process.exit(1);
  }
}

testConnection();
