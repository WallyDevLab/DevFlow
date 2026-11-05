import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * Limits a string by its size in UTF-8 bytes. bcrypt silently ignores
 * everything after the 72nd byte, so a 72-character password containing
 * non-ASCII characters would otherwise be truncated without warning.
 */
export function MaxBytes(max: number, options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'maxBytes',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be at most ${max} bytes (characters outside basic ASCII use several)`,
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max,
      },
    });
}
