import dotenv from 'dotenv'
import {connect} from 'framer-api'
import {existsSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const localEnv = resolve(scriptDirectory, '../.env')
const parentEnv = resolve(scriptDirectory, '../../.env')
dotenv.config({path: existsSync(localEnv) ? localEnv : parentEnv})

if (!process.env.FRAMER_PROJECT_URL || !process.env.FRAMER_API_KEY) {
  throw new Error('Set FRAMER_PROJECT_URL and FRAMER_API_KEY in .env first')
}

const framer = await connect(process.env.FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
try {
  const collections = await framer.getManagedCollections()
  if (!collections.length) {
    console.log('No managed collections found through the Server API.')
    const allCollections = await framer.getCollections()
    for (const collection of allCollections) {
      console.log(`${collection.id}\t${collection.name}\tmanagedBy=${collection.managedBy}`)
    }
    if (!allCollections.length) console.log('No collections found in this Framer project.')
  } else {
    for (const collection of collections) {
      console.log(`${collection.id}\t${collection.name}`)
    }
  }

  console.log('Use a collection ID from the list above as FRAMER_COLLECTION_ID.')
} finally {
  await framer.disconnect()
}
