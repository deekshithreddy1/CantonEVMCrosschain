export type RegistryErrorCode = "ALREADY_EXISTS" | "NOT_FOUND" | "INVALID_ARGUMENT" | "CONFLICT";

export class RegistryError extends Error {
  constructor(readonly code: RegistryErrorCode, message: string) {
    super(message);
    this.name = "RegistryError";
  }
}
