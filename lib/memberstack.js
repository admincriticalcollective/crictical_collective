import {createRemoteJWKSet, errors, jwtVerify} from 'jose'

const signingKeys = createRemoteJWKSet(
  new URL('https://member-jwt.s3.us-east-1.amazonaws.com/jwks.json'),
  {timeoutDuration: 5000},
)

const invalidTokenErrors = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWSSignatureVerificationFailed,
  errors.JWSInvalid,
  errors.JWTInvalid,
  errors.JOSEAlgNotAllowed,
  errors.JWKSNoMatchingKey,
]

export function createMemberAuthenticator({
  appId,
  secretKey,
  keySet = signingKeys,
  fetchImpl = fetch,
  clock = () => new Date(),
}) {
  return async function authenticate(token) {
    if (!appId || !secretKey) throw new Error('Memberstack is not configured')

    let payload
    try {
      const verified = await jwtVerify(token, keySet, {
        issuer: 'https://api.memberstack.com',
        audience: appId,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'id', 'type'],
        currentDate: clock(),
      })
      payload = verified.payload
    } catch (error) {
      if (invalidTokenErrors.some(ErrorType => error instanceof ErrorType)) return null
      throw error
    }
    if (payload.type !== 'member' || typeof payload.id !== 'string' ||
        !/^mem_[A-Za-z0-9_-]+$/.test(payload.id) || payload.id.length > 50) {
      return null
    }

    const response = await fetchImpl(
      `https://admin.memberstack.com/members/${encodeURIComponent(payload.id)}`,
      {
        headers: {'X-API-KEY': secretKey, Accept: 'application/json'},
        signal: AbortSignal.timeout(6000),
        redirect: 'error',
        cache: 'no-store',
      },
    )
    if (response.status === 404) return null
    if (!response.ok) throw new Error('Member lookup failed')
    const result = await response.json()
    if (result?.data?.id !== payload.id) return null
    return {id: payload.id}
  }
}