import { Request, Response, NextFunction, ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { logError } from '../logger/logger'

export const errorMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  console.error('[Error]', err.message)
  logError('http.error', err, {
    method: req.method,
    path: req.originalUrl,
  })
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.flatten() } })
  }
  const status = err.statusCode || err.status || 500
  res.status(status).json({ error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Internal server error' } })
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
}

export function setupSSE(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()
}

export function sendSSE(res: Response, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

export function endSSE(res: Response) {
  res.write('data: [DONE]\n\n')
  res.end()
}

