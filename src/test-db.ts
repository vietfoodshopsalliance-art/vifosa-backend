import 'dotenv/config'
import { connectDB, seedSettings } from './modules/db'

async function main() {
  await connectDB()
  await seedSettings()
  console.log('✅ Done')
  process.exit(0)
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})