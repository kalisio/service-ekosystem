import { ObjectId } from 'mongodb'

/**
 * Generates a new MongoDB ObjectId.
 *
 * @returns {ObjectId} - A new MongoDB ObjectId.
 */
export function generateObjectId () {
  return new ObjectId()
}

export function convertToObjectId (id) {
  return new ObjectId(id)
}

/**
 * Check if the given value is a valid MongoDB ObjectId.
 *
 * @param {string} id - The value to be checked.
 * @returns {boolean} - True if the value is a valid ObjectId, false otherwise.
 */
export function isObjectId (id) {
  return ObjectId.isValid(id)
}
