import { mongoose } from 'mongoose'

/**
 * Generates a new MongoDB ObjectId.
 *
 * @returns {ObjectId} - A new MongoDB ObjectId.
 */
export function generateObjectId () {
  return new mongoose.Types.ObjectId()
}

export function convertToObjectId (id) {
  return new mongoose.Types.ObjectId(id)
}

/**
 * Check if the given value is a valid MongoDB ObjectId.
 *
 * @param {string} id - The value to be checked.
 * @returns {boolean} - True if the value is a valid ObjectId, false otherwise.
 */
export function isObjectId (id) {
  return mongoose.Types.ObjectId.isValid(id)
}
