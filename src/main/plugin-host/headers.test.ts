import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyPluginHeaders } from './headers.ts'

test('our own Origin and Referer never go out', () => {
  assert.deepEqual(
    applyPluginHeaders({ Origin: 'http://localhost:5173', Referer: 'http://localhost/', Accept: '*/*' }),
    {
      Accept: '*/*'
    }
  )
})

test('a plugin can ask for User-Agent, Origin and Referer through X-Plugin headers', () => {
  assert.deepEqual(
    applyPluginHeaders({
      'User-Agent': 'Electron',
      Accept: '*/*',
      'X-Plugin-User-Agent': 'SomeApp/1.0',
      'x-plugin-origin': 'https://music.example.org',
      'X-Plugin-Referer': 'https://music.example.org/'
    }),
    {
      Accept: '*/*',
      'User-Agent': 'SomeApp/1.0',
      Origin: 'https://music.example.org',
      Referer: 'https://music.example.org/'
    }
  )
})

test('other X-Plugin headers and odd values are dropped, and the browser’s User-Agent stays otherwise', () => {
  assert.deepEqual(
    applyPluginHeaders({ 'User-Agent': 'Electron', 'X-Plugin-Cookie': 'a=b', 'X-Plugin-Origin': 'bad\u0000value' }),
    { 'User-Agent': 'Electron' }
  )
})
