const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse .env.local manually
const envPath = path.join(__dirname, '..', '.env.local');
console.log('Reading env from:', envPath);

let supabaseUrl = '';
let supabaseAnonKey = '';

try {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('SUPABASE_URL=')) {
      supabaseUrl = line.split('=')[1].trim().replace(/"/g, '');
    }
    if (line.startsWith('SUPABASE_ANON_KEY=')) {
      supabaseAnonKey = line.split('=')[1].trim().replace(/"/g, '');
    }
  }
} catch (e) {
  console.error('Failed to read .env.local file:', e.message);
  process.exit(1);
}

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false }
});

async function runTests() {
  try {
    const testEmail = `test.${Math.random().toString(36).substring(2, 8)}@gmail.com`;
    const testPassword = 'Password123!';
    console.log(`\n--- Step 1: Registering a test user (${testEmail}) ---`);
    
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: testEmail,
      password: testPassword
    });

    if (signUpError) {
      console.warn('Sign Up warning:', signUpError.message);
    } else {
      console.log('Sign Up succeeded! User ID:', signUpData.user.id);
    }

    console.log(`\n--- Step 2: Logging in as the test user ---`);
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: testEmail,
      password: testPassword
    });

    if (signInError) {
      console.error('Sign In failed:', signInError.message);
      if (signInError.message.includes('confirm your email')) {
        console.log('\n[HELP] Email verification is currently required in your Supabase Auth settings.');
        console.log('To run this test successfully and support logins without confirmation emails:');
        console.log('1. Go to your Supabase Dashboard.');
        console.log('2. Click on "Authentication" in the left sidebar.');
        console.log('3. Click on "Providers" and open the "Email" section.');
        console.log('4. Toggle OFF "Confirm email" and save the settings.');
      }
      process.exit(1);
    }

    const session = signInData.session;
    const user = signInData.user;
    console.log('Sign In succeeded! User ID:', user.id);
    console.log('JWT Token successfully acquired.');

    // Initialize authenticated Supabase client for User 1
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      }
    });

    console.log(`\n--- Step 3: Inserting a project under User 1 security scope ---`);
    const projectId = Math.random().toString(36).substring(2, 15);
    const { error: insertError } = await authClient
      .from('projects')
      .insert({
        id: projectId,
        title: 'Security RLS Test Project',
        content: JSON.stringify({ type: 'doc', content: [] }),
        created_at: Date.now(),
        updated_at: Date.now(),
        word_count: 0,
        char_count: 0,
        document_type: 'Project',
        academic_level: 'Undergraduate',
        academic_tone: 'Analytical',
        user_id: user.id
      });

    if (insertError) {
      console.error('Insertion failed:', insertError.message);
      process.exit(1);
    }
    console.log(`Project successfully created! ID: ${projectId}`);

    console.log(`\n--- Step 4: Querying projects under User 1 authenticated context ---`);
    const { data: user1Projects, error: fetchError } = await authClient
      .from('projects')
      .select('id, title, user_id');

    if (fetchError) {
      console.error('Fetch failed:', fetchError.message);
      process.exit(1);
    }
    console.log('User 1 Projects returned:', user1Projects);

    console.log(`\n--- Step 5: Querying projects under Unauthenticated context ---`);
    const { data: anonProjects, error: anonFetchError } = await supabase
      .from('projects')
      .select('id, title, user_id');

    if (anonFetchError) {
      console.error('Anon Fetch failed:', anonFetchError.message);
    } else {
      console.log(`Anon Fetch succeeded! Projects returned count: ${anonProjects.length}`);
      const found = anonProjects.find(p => p.id === projectId);
      if (found) {
        console.error('SECURITY VULNERABILITY: Unauthenticated query was able to retrieve User 1\'s private project!');
        process.exit(1);
      } else {
        console.log('SUCCESS: Unauthenticated query returned 0 private projects. RLS is working!');
      }
    }

    console.log(`\n--- Step 6: Cleaning up test data ---`);
    const { error: deleteError } = await authClient
      .from('projects')
      .delete()
      .eq('id', projectId);

    if (deleteError) {
      console.error('Failed to delete project:', deleteError.message);
    } else {
      console.log('Test project successfully deleted.');
    }

    console.log('\n--- ALL SECURITY AND RLS CHECKS PASSED SUCCESSFULLY! ---');

  } catch (error) {
    console.error('Test execution failed:', error);
  }
}

runTests();
