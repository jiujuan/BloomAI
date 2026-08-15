import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GitHubSourceError,
  downloadGitHubArchive,
  parseGitHubSource,
  resolveGitHubCommit,
  type GitHubFetch,
} from './github-source'

const sha = 'a'.repeat(40)

function response(body: BodyInit | null, init: ResponseInit = {}) {
  return new Response(body, init)
}

const source = parseGitHubSource('https://github.com/acme/skills.git', 'feature/issue-123')

afterEach(() => { vi.restoreAllMocks() })

describe('github source', () => {
  it('parses only an exact github owner/repository URL and preserves a safe ref', () => {
    expect(source).toMatchObject({
      owner: 'acme',
      repository: 'skills',
      repositoryUrl: 'https://github.com/acme/skills.git',
      ref: 'feature/issue-123',
    })
    expect(() => parseGitHubSource('http://github.com/acme/skills', 'main')).toThrowError(GitHubSourceError)
    expect(() => parseGitHubSource('https://evil.example/acme/skills', 'main')).toThrowError(/github/i)
    expect(() => parseGitHubSource('https://github.com/acme/skills/extra', 'main')).toThrowError(/exactly one/i)
    expect(() => parseGitHubSource('https://github.com/acme/skills?redirect=https://evil.example', 'main')).toThrowError(/query/i)
    expect(() => parseGitHubSource('https://github.com/acme/skills', 'feature bad')).toThrowError(/ref/i)
  })

  it('resolves a ref to a canonical 40-character commit SHA', async () => {
    const fetchImpl = vi.fn<[string | URL, RequestInit?], Promise<Response>>().mockResolvedValue(response(JSON.stringify({ sha })))
    const resolved = await resolveGitHubCommit(source, { fetchImpl })
    expect(resolved).toEqual({ commitSha: sha, apiUrl: `https://api.github.com/repos/acme/skills/commits/feature%2Fissue-123` })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/skills/commits/feature%2Fissue-123',
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  it.each([
    [404, {}, 'GITHUB_REF_NOT_FOUND'],
    [401, {}, 'GITHUB_UNAUTHORIZED'],
    [403, { 'x-ratelimit-remaining': '0' }, 'GITHUB_RATE_LIMITED'],
  ] as const)('maps GitHub API status %s to a stable error', async (status, headers, code) => {
    const fetchImpl = vi.fn<[string | URL, RequestInit?], Promise<Response>>().mockResolvedValue(response('failure', { status, headers }))
    await expect(resolveGitHubCommit(source, { fetchImpl })).rejects.toMatchObject({ code })
  })

  it('rejects an invalid commit response instead of treating ref as a version', async () => {
    const fetchImpl = vi.fn<[string | URL, RequestInit?], Promise<Response>>().mockResolvedValue(response(JSON.stringify({ sha: 'main' })))
    await expect(resolveGitHubCommit(source, { fetchImpl })).rejects.toMatchObject({ code: 'GITHUB_INVALID_COMMIT_SHA' })
  })

  it('blocks redirects to non-GitHub hosts', async () => {
    const fetchImpl = vi.fn<[string | URL, RequestInit?], Promise<Response>>().mockResolvedValue(response(null, {
      status: 302,
      headers: { location: 'https://evil.example/payload.zip' },
    }))
    await expect(downloadGitHubArchive(source, sha, { fetchImpl })).rejects.toMatchObject({ code: 'GITHUB_REDIRECT_BLOCKED' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('uses the stable refs/heads archive URL before the SHA archive URL', async () => {
    const archive = Buffer.from('branch-archive')
    const fetchImpl = vi.fn<[string | URL, RequestInit?], Promise<Response>>().mockResolvedValue(response(archive, {
      status: 200,
      headers: { 'content-length': String(archive.length) },
    }))

    const result = await downloadGitHubArchive(source, sha, { fetchImpl })

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://github.com/acme/skills/archive/refs/heads/feature/issue-123.zip',
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(result.archiveUrl).toBe('https://github.com/acme/skills/archive/refs/heads/feature/issue-123.zip')
  })

  it('accepts a GitHub refs/heads redirect to codeload without losing the requested ref', async () => {
    const archive = Buffer.from('redirected-branch-archive')
    const fetchImpl = vi.fn<[string | URL, RequestInit?], Promise<Response>>()
      .mockResolvedValueOnce(response(null, {
        status: 302,
        headers: { location: 'https://codeload.github.com/acme/skills/zip/refs/heads/feature/issue-123' },
      }))
      .mockResolvedValueOnce(response(archive, {
        status: 200,
        headers: { 'content-length': String(archive.length) },
      }))

    const result = await downloadGitHubArchive(source, sha, { fetchImpl })

    expect(result.archiveUrl).toBe('https://codeload.github.com/acme/skills/zip/refs/heads/feature/issue-123')
  })

  it('accepts GitHub canonical owner and repository casing in an otherwise exact archive redirect', async () => {
    const baoyuSource = parseGitHubSource('https://github.com/jimliu/baoyu-skills', 'main')
    const archive = Buffer.from('redirected-branch-archive')
    const fetchImpl = vi.fn<[string | URL, RequestInit?], Promise<Response>>()
      .mockResolvedValueOnce(response(null, {
        status: 302,
        headers: { location: 'https://codeload.github.com/JimLiu/baoyu-skills/zip/refs/heads/main' },
      }))
      .mockResolvedValueOnce(response(archive, {
        status: 200,
        headers: { 'content-length': String(archive.length) },
      }))

    const result = await downloadGitHubArchive(baoyuSource, sha, { fetchImpl })

    expect(result.archiveUrl).toBe('https://codeload.github.com/JimLiu/baoyu-skills/zip/refs/heads/main')
  })

  it('falls back from a missing branch archive to the refs/tags archive URL', async () => {
    const tagSource = parseGitHubSource('https://github.com/acme/skills', 'v1.2.3')
    const archive = Buffer.from('tag-archive')
    const fetchImpl = vi.fn<[string | URL, RequestInit?], Promise<Response>>()
      .mockResolvedValueOnce(response('missing branch', { status: 404 }))
      .mockResolvedValueOnce(response(archive, {
        status: 200,
        headers: { 'content-length': String(archive.length) },
      }))

    const result = await downloadGitHubArchive(tagSource, sha, { fetchImpl })

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://github.com/acme/skills/archive/refs/heads/v1.2.3.zip',
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://github.com/acme/skills/archive/refs/tags/v1.2.3.zip',
      expect.objectContaining({ redirect: 'manual' }),
    )
    expect(result.archiveUrl).toBe('https://github.com/acme/skills/archive/refs/tags/v1.2.3.zip')
  })

  it('rejects a ref archive redirect that changes the requested branch', async () => {
    const fetchImpl = vi.fn<[string | URL, RequestInit?], Promise<Response>>().mockResolvedValue(response(null, {
      status: 302,
      headers: { location: 'https://codeload.github.com/acme/skills/zip/refs/heads/main' },
    }))

    await expect(downloadGitHubArchive(source, sha, { fetchImpl })).rejects.toMatchObject({
      code: 'GITHUB_REDIRECT_BLOCKED',
      message: 'GitHub archive redirect target is not the requested immutable archive',
    })
  })

  it('validates content length and actual response bytes', async () => {
    const fetchImpl = vi.fn<[string | URL, RequestInit?], Promise<Response>>().mockResolvedValue(response(Buffer.from('short'), {
      status: 200,
      headers: { 'content-length': '99' },
    }))
    await expect(downloadGitHubArchive(source, sha, { fetchImpl })).rejects.toMatchObject({ code: 'GITHUB_CONTENT_LENGTH_MISMATCH' })
  })

  it('enforces the archive byte limit before accepting the body', async () => {
    const fetchImpl = vi.fn<[string | URL, RequestInit?], Promise<Response>>().mockResolvedValue(response(Buffer.from('12345'), {
      status: 200,
      headers: { 'content-length': '5' },
    }))
    await expect(downloadGitHubArchive(source, sha, { fetchImpl, maxArchiveBytes: 4 })).rejects.toMatchObject({ code: 'GITHUB_ARCHIVE_TOO_LARGE' })
  })

  it('returns reproducible archive metadata for an allowed redirect', async () => {
    const archive = Buffer.from('zip-bytes')
    const fetchImpl = vi.fn<[string | URL, RequestInit?], Promise<Response>>()
      .mockResolvedValueOnce(response(null, {
        status: 302,
        headers: { location: `https://codeload.github.com/acme/skills/zip/${sha}` },
      }))
      .mockResolvedValueOnce(response(archive, {
        status: 200,
        headers: { 'content-length': String(archive.length), etag: '"abc"' },
      }))
    const result = await downloadGitHubArchive(source, sha, { fetchImpl, now: () => new Date('2026-08-06T00:00:00.000Z') })
    expect(result).toMatchObject({
      sourceUrl: source.repositoryUrl,
      archiveUrl: `https://codeload.github.com/acme/skills/zip/${sha}`,
      sourceRef: source.ref,
      resolvedCommitSha: sha,
      archiveSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      fetchedAt: '2026-08-06T00:00:00.000Z',
      etag: '"abc"',
    })
    expect(result.archive).toEqual(archive)
  })

  it('maps aborts and network failures to stable errors', async () => {
    const timeoutFetch = vi.fn<[string | URL, RequestInit?], Promise<Response>>().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await expect(resolveGitHubCommit(source, { fetchImpl: timeoutFetch, timeoutMs: 1 })).rejects.toMatchObject({ code: 'GITHUB_TIMEOUT' })
    const networkFetch = vi.fn<[string | URL, RequestInit?], Promise<Response>>().mockRejectedValue(new Error('socket closed'))
    await expect(resolveGitHubCommit(source, { fetchImpl: networkFetch })).rejects.toMatchObject({ code: 'GITHUB_NETWORK_ERROR' })
  })
})
