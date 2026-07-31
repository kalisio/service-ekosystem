import { expect } from 'vitest'

/**
 * Expects the provided function to throw an error with a specific message.
 * - since expect.--.toThrow() doesn't work for some reason.
 * @param {Function} fn - The function to be executed and expected to throw an error.
 * @param {string} message - The message that the error is expected to have.
 */
export async function expectError (fn, message) {
  let gotError = false
  try {
    await fn()
  } catch (error) {
    gotError = true
    expect(error.message).toBe(message)
  }
  if (!gotError) {
    throw new Error('Did not throw an error (expected: ' + message + ')')
  }
}
/**
 * Asynchronously waits for a specific event from a service within a specified timeout period.
 *
 * @param {Object} service - The service object that emits the event.
 * @param {string} eventName - The name of the event to wait for.
 * @param {number} [timeout=3500] - The maximum time to wait for the event in milliseconds.
 * @returns {Promise<any>} A promise that resolves with the data when the event is received, or rejects with an error if the event is not received within the timeout.
 */
export async function waitEvent (service, eventName, timeout = 3500) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearTimeout(timeoutId)
      reject(new Error('Event not received within timeout'))
    }, timeout)

    service.once(eventName, (data) => {
      clearTimeout(timeoutId)
      resolve(data)
    })
  }
  )
}

/**
 * Asynchronously waits for a specified amount of time.
 *
 * @param {number} [ms=9000000] - The time to wait in milliseconds.
 * @returns {Promise<void>} A promise that resolves after the specified time has elapsed.
 */
export async function wait (ms = 9000000) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
