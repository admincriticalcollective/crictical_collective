import dotenv from 'dotenv'
import {connect} from 'framer-api'
import {AUTHOR_FIELDS} from '../lib/framer.js'
import {existsSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const localEnv = resolve(scriptDirectory, '../.env')
const parentEnv = resolve(scriptDirectory, '../../.env')
dotenv.config({path: existsSync(localEnv) ? localEnv : parentEnv})

if (!process.env.FRAMER_PROJECT_URL || !process.env.FRAMER_API_KEY || !process.env.FRAMER_AUTHORS_COLLECTION_ID) {
  throw new Error('Set FRAMER_PROJECT_URL, FRAMER_API_KEY, and FRAMER_AUTHORS_COLLECTION_ID in .env first')
}

const framer = await connect(process.env.FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
try {
  const collection = await framer.getCollection(process.env.FRAMER_AUTHORS_COLLECTION_ID)
  if (!collection) throw new Error(`Framer collection not found: ${process.env.FRAMER_AUTHORS_COLLECTION_ID}`)
  if (collection.managedBy !== 'user') throw new Error(`Collection is managed by ${collection.managedBy}; use an unmanaged collection`)
  const existingFields = await collection.getFields()
  const existingNames = new Set(existingFields.map(field => field.name))
  const fieldsToAdd = AUTHOR_FIELDS.filter(field => !existingNames.has(field.name)).map(({id, ...field}) => field)
  if (fieldsToAdd.length) await collection.addFields(fieldsToAdd)
  console.log(`Configured ${collection.name}; added ${fieldsToAdd.length} custom field(s)`)
} finally {
  await framer.disconnect()
}