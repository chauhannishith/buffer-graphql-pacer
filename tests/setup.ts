import { afterAll, afterEach, beforeAll } from 'vitest'
import { setupServer } from 'msw/node'
import { bufferApiHandlers, resetBufferApiMockState } from './mocks/buffer-api'

const server = setupServer(...bufferApiHandlers)

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
  resetBufferApiMockState()
})

afterAll(() => {
  server.close()
})
