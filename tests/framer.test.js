import assert from 'node:assert/strict'
import test from 'node:test'
import {articleToFramerItem} from '../lib/framer.js'

const article = {
  _id: 'article-example',
  slug: 'example',
  title: 'Example article',
}

test('articleToFramerItem omits missing numeric fields', () => {
  const item = articleToFramerItem(article)

  assert.equal('year' in item.fieldData, false)
  assert.equal('readingTime' in item.fieldData, false)
})

test('articleToFramerItem sends valid numeric values to Framer', () => {
  const item = articleToFramerItem({...article, year: '2024', readingTimeMins: 8})

  assert.deepEqual(item.fieldData.year, {type: 'number', value: 2024})
  assert.deepEqual(item.fieldData.readingTime, {type: 'number', value: 8})
})

test('articleToFramerItem omits non-numeric values', () => {
  const item = articleToFramerItem({...article, year: 'unknown', readingTimeMins: NaN})

  assert.equal('year' in item.fieldData, false)
  assert.equal('readingTime' in item.fieldData, false)
})