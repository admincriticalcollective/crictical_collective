import assert from 'node:assert/strict'
import test from 'node:test'
import {articleToFramerItem, FRAMER_FIELDS, planCollectionSync} from '../lib/framer.js'

const fieldIds = Object.fromEntries(FRAMER_FIELDS.map(({id}) => [id, id]))

test('full-sync plan updates matching items, adds missing items, and prunes only stale sync-owned items', () => {
  const documents = [
    {_id: 'article-1', title: 'One', slug: 'one'},
    {_id: 'article-2', title: 'Two', slug: 'two'},
  ]
  const existingItems = [
    {id: 'framer-1', slug: 'one', fieldData: {'Sanity ID': {value: 'article-1'}}},
    {id: 'stale', fieldData: {'Sanity ID': {value: 'article-old'}}},
    {id: 'manual', fieldData: {Title: {value: 'Manually created'}}},
    {id: 'duplicate', fieldData: {'Sanity ID': {value: 'article-1'}}},
  ]

  const plan = planCollectionSync(documents, existingItems, fieldIds, articleToFramerItem)

  assert.equal(plan.items.length, 2)
  assert.equal(plan.items[0].id, 'framer-1')
  assert.equal(plan.items[1].id, undefined)
  assert.deepEqual(plan.staleItemIds, ['stale', 'duplicate'])
  assert.equal(plan.skipped, 0)
})

test('full-sync plan skips incomplete Sanity records', () => {
  const plan = planCollectionSync(
    [{_id: 'article-incomplete', title: 'Missing slug'}],
    [],
    fieldIds,
    articleToFramerItem,
  )

  assert.equal(plan.items.length, 0)
  assert.equal(plan.skipped, 1)
})

test('full-sync plan adopts a legacy item with the same slug and title', () => {
  const plan = planCollectionSync(
    [{_id: 'article-2', title: 'Two', slug: 'two'}],
    [{id: 'legacy-two', slug: 'two', fieldData: {'Sanity ID': {value: ''}, Title: {value: 'Two'}}}],
    fieldIds,
    articleToFramerItem,
  )

  assert.equal(plan.items[0].id, 'legacy-two')
  assert.deepEqual(plan.staleItemIds, [])
})

test('full-sync plan rejects a same-slug legacy item with different content', () => {
  assert.throws(() => planCollectionSync(
    [{_id: 'article-2', title: 'Two', slug: 'two'}],
    [{id: 'manual-two', slug: 'two', fieldData: {Title: {value: 'Different item'}}}],
    fieldIds,
    articleToFramerItem,
  ), /Framer slug conflict for two/)
})