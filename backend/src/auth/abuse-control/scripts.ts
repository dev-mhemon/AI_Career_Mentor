/** All scripts target one standalone Redis authority; multi-key Redis Cluster is excluded. */
/** Keep one policy active until all state created by its latest operation can expire. */
export const policyGuard = `
local policyKey = table.remove(KEYS)
local fingerprint = table.remove(ARGV, 1)
local lifetime = table.remove(ARGV, 1)
local existing = redis.call('GET', policyKey)
if existing and existing ~= fingerprint then
  return {6, math.max(1, redis.call('PTTL', policyKey))}
end
redis.call('SET', policyKey, fingerprint, 'PX', lifetime)
`;

export const sendScript = `
local cooldown = redis.call('PTTL', KEYS[1])
if cooldown == -1 then return {6, 1000} end
if cooldown >= 0 then return {1, math.max(1, cooldown)} end
local wait = 0
for i = 2, 3 do
  if redis.call('PTTL', KEYS[i]) == -1 then return {6, 1000} end
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i]) then
    wait = math.max(wait, math.max(1, redis.call('PTTL', KEYS[i])))
  end
end
if wait > 0 then return {2, wait} end
for i = 2, 3 do
  local n = redis.call('INCR', KEYS[i])
  if n == 1 then redis.call('PEXPIRE', KEYS[i], ARGV[4]) end
end
redis.call('SET', KEYS[1], '1', 'PX', ARGV[1])
return {0, tonumber(ARGV[1])}
`;

export const issueScript = `
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'generation', ARGV[1], 'failures', 0, 'consumed', 0)
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return {0, tonumber(ARGV[2])}
`;

export const challengeScript = `
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  return {3, 0}
end
local generation = redis.call('HGET', KEYS[1], 'generation')
if ARGV[3] ~= 'begin' and generation ~= ARGV[1] then return {3, 0} end
if redis.call('HGET', KEYS[1], 'consumed') == '1' then return {4, 0} end
if tonumber(redis.call('HGET', KEYS[1], 'failures')) >= tonumber(ARGV[4]) then
  return {5, ttl}
end
if ARGV[3] == 'begin' then
  if redis.call('HEXISTS', KEYS[1], 'busy') == 1 then return {6, ttl} end
  redis.call('HSET', KEYS[1], 'busy', ARGV[2])
  return {0, ttl, generation}
end
if redis.call('HGET', KEYS[1], 'busy') ~= ARGV[2] then return {6, ttl} end
if ARGV[3] == 'abort' then
  redis.call('HDEL', KEYS[1], 'busy')
  return {0, ttl}
end
if ARGV[3] == 'valid' then
  redis.call('HSET', KEYS[1], 'consumed', 1)
  redis.call('HDEL', KEYS[1], 'busy')
  if KEYS[2] then redis.call('DEL', KEYS[2]) end
  return {0, ttl}
end
redis.call('HDEL', KEYS[1], 'busy')
local failures = redis.call('HINCRBY', KEYS[1], 'failures', 1)
if failures >= tonumber(ARGV[4]) then
  if KEYS[2] then redis.call('DEL', KEYS[2]) end
  return {5, ttl}
end
return {7, 0}
`;

export const loginScript = `
local lock = redis.call('PTTL', KEYS[2])
if lock == -1 or redis.call('PTTL', KEYS[1]) == -1 then return {6, 1000} end
if lock >= 0 then return {8, math.max(1, lock)} end
if ARGV[1] == 'begin' then
  if not redis.call('SET', KEYS[3], ARGV[2], 'NX', 'PX', ARGV[4]) then
    return {6, redis.call('PTTL', KEYS[3])}
  end
  return {0, 0}
end
if redis.call('GET', KEYS[3]) ~= ARGV[2] then return {6, tonumber(ARGV[4])} end
redis.call('DEL', KEYS[3])
if ARGV[1] == 'valid' then
  redis.call('DEL', KEYS[1])
  return {0, 0}
end
local failures = redis.call('INCR', KEYS[1])
if failures == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[4]) end
if failures >= tonumber(ARGV[3]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[5])
  redis.call('DEL', KEYS[1])
  return {8, tonumber(ARGV[5])}
end
return {9, 0}
`;
