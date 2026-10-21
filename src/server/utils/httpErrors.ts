export class InputValidationError extends Error {
  readonly statusCode = 400;
}

export class ConflictError extends Error {
  readonly statusCode = 409;
}
