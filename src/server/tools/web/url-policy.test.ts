import { describe, expect, it } from 'vitest'
import { isPublicAddress, validateInitialUrl, validateRedirectUrl } from './url-policy'

const publicLookup = async () => ['93.184.216.34']

describe('shared web URL policy', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '169.254.1.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it('rejects a DNS response containing any private address', async () => {
    await expect(validateInitialUrl('https://public.example.test', {
      lookup: async () => ['93.184.216.34', '192.168.1.20'],
    })).rejects.toThrow('private or local')
  })

  it('validates each redirect target before another request can start', async () => {
    await expect(validateRedirectUrl(
      'http://127.0.0.1:4318/private',
      'https://public.example.test/start',
      { lookup: publicLookup },
    )).rejects.toThrow('private or local')
  })

  it('accepts a credential-free public HTTP(S) URL', async () => {
    await expect(validateInitialUrl('https://public.example.test/article', {
      lookup: publicLookup,
    })).resolves.toEqual(new URL('https://public.example.test/article'))
  })
})
