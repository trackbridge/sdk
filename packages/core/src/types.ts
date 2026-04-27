/**
 * Postal address, sub-shape of {@link UserData}.
 *
 * `country` is ISO-3166-1 alpha-2 (e.g. `US`, `BR`). `region` is the
 * state/province code or name; Google's enhanced conversions spec
 * accepts either form for most countries.
 */
export type Address = {
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

/**
 * The user-identifying fields used for enhanced conversions matching.
 *
 * Identical shape on browser and server — both packages import this type
 * from `@trackbridge/core`. All fields are pre-normalization; the SDK
 * applies normalization and SHA-256 hashing before sending to Google.
 */
export type UserData = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  address?: Address;
};

/**
 * Hashed-form counterpart of {@link Address}. Same structural shape; the
 * alias exists so function signatures can distinguish raw input from
 * post-hash output at the type level.
 */
export type HashedAddress = {
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

/**
 * Hashed-form counterpart of {@link UserData}. Each string field holds a
 * lowercase hex SHA-256 digest of the normalized input value. Fields that
 * were absent or normalized to an empty string are omitted entirely.
 */
export type HashedUserData = {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  address?: HashedAddress;
};
