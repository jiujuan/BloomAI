import { describe, expect, it } from 'vitest'
import { validateExternalUrl } from './url-policy'

const publicLookup = async (hostname: string) => hostname === 'public.example.test'
  ? ['93.184.216.34']
  : []

describe('UrlPolicy', () => {
  it('accepts credential-free HTTP(S) public URLs', async () => {
    await expect(validateExternalUrl('https://public.example.test/articles', {
      lookup: publicLookup,
    })).resolves.toEqual(new URL('https://public.example.test/articles'))
  })

  it.each([
    'file:///etc/passwd',
    'ftp://public.example.test/file',
    'https://user:pass@public.example.test/private',
    'https://',
  ])('rejects unsafe URL form %s', async (value) => {
    await expect(validateExternalUrl(value, { lookup: publicLookup })).rejects.toThrow('unsafe external URL')
  })

  it.each([
    'http://localhost/admin',
    'http://service.localhost/health',
    'http://127.0.0.1:8080',
    'http://10.0.0.1/internal',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://[fc00::1]/',
  ])('rejects local or private target %s', async (value) => {
    await expect(validateExternalUrl(value, { lookup: publicLookup })).rejects.toThrow('private or local')
  })

  it('rejects a hostname when DNS resolves to a private address', async () => {
    await expect(validateExternalUrl('https://public.example.test', {
      lookup: async () => ['192.168.1.10'],
    })).rejects.toThrow('private or local')
  })
})
