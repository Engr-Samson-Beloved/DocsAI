import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envPath = './.env.local'
const envContent = fs.readFileSync(envPath, 'utf-8')
const envVars = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w_]+)\s*=\s*"?([^"#\r\n]+)"?/)
  if (match) {
    envVars[match[1]] = match[2].trim()
  }
})

const supabaseUrl = envVars.SUPABASE_URL
const supabaseAnonKey = envVars.SUPABASE_ANON_KEY

console.log('--- 🧪 WordPIlot Supabase Schema & Security Verification ---')
console.log(`Connecting to: ${supabaseUrl}\n`)

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function runVerification() {
  const results = {
    projectsTable: false,
    projectsUserEmailCol: false,
    sourcesTable: false,
    sourcesUserEmailCol: false,
    subscriptionsTable: false,
    rlsActive: false
  }

  // 1. Check projects table & user_email column
  try {
    const { data, error } = await supabase.from('projects').select('id, user_email, title').limit(1)
    if (error && error.code !== 'PGRST116') {
      console.error('❌ Error querying "projects" table:', error.message)
    } else {
      results.projectsTable = true
      results.projectsUserEmailCol = true
      console.log('✅ "projects" table exists with "user_email" column!')
    }
  } catch (e) {
    console.error('❌ Exception on "projects" query:', e.message)
  }

  // 2. Check project_sources table & user_email column
  try {
    const { data, error } = await supabase.from('project_sources').select('id, project_id, user_email, name').limit(1)
    if (error && error.code !== 'PGRST116') {
      console.error('❌ Error querying "project_sources" table:', error.message)
    } else {
      results.sourcesTable = true
      results.sourcesUserEmailCol = true
      console.log('✅ "project_sources" table exists with "user_email" column!')
    }
  } catch (e) {
    console.error('❌ Exception on "project_sources" query:', e.message)
  }

  // 3. Check subscriptions table
  try {
    const { data, error } = await supabase.from('subscriptions').select('id, email, plan_tier, status').limit(1)
    if (error && error.code !== 'PGRST116') {
      console.error('❌ Error querying "subscriptions" table:', error.message)
    } else {
      results.subscriptionsTable = true
      console.log('✅ "subscriptions" table exists!')
    }
  } catch (e) {
    console.error('❌ Exception on "subscriptions" query:', e.message)
  }

  // 4. Test RLS Protection
  try {
    const { error: rlsErr } = await supabase.from('projects').insert({
      id: `unauth_test_${Date.now()}`,
      title: 'Unauthenticated Test',
      content: '<p>Test</p>',
      created_at: Date.now(),
      updated_at: Date.now()
    })

    if (rlsErr && (rlsErr.message.includes('row-level security') || rlsErr.code === '42501')) {
      results.rlsActive = true
      console.log('🔒 Row Level Security (RLS) is ACTIVE & PROTECTING tables against unauthenticated writes!')
    }
  } catch (e) {}

  console.log('\n======================================================')
  console.log('📊 FINAL VERIFICATION REPORT')
  console.log('======================================================')
  console.log(`• Projects Table:                ${results.projectsTable ? '✅ PASSED' : '❌ FAILED'}`)
  console.log(`• Projects user_email Column:    ${results.projectsUserEmailCol ? '✅ PASSED' : '❌ FAILED'}`)
  console.log(`• Project Sources Table:         ${results.sourcesTable ? '✅ PASSED' : '❌ FAILED'}`)
  console.log(`• Project Sources user_email Col:${results.sourcesUserEmailCol ? '✅ PASSED' : '❌ FAILED'}`)
  console.log(`• Subscriptions Table:           ${results.subscriptionsTable ? '✅ PASSED' : '❌ FAILED'}`)
  console.log(`• Row Level Security (RLS):      ${results.rlsActive ? '✅ ACTIVE & SECURE' : '⚠️ UNPROTECTED'}`)
  console.log('======================================================')

  if (results.projectsTable && results.sourcesTable && results.subscriptionsTable && results.rlsActive) {
    console.log('\n🎉 SUCCESS! Your SQL script was applied perfectly and your Supabase database is 100% ready for cross-device sync!')
  }
}

runVerification()
