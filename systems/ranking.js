export const RANKS = [
  { name: "Bronze", mmr: 0, color: 0x8d6e63 },
  { name: "Silver", mmr: 1200, color: 0xb0bec5 },
  { name: "Gold", mmr: 1800, color: 0xf1c40f },
  { name: "Platinum", mmr: 2500, color: 0x00bcd4 },
  { name: "Diamond", mmr: 3500, color: 0x3498db },
  { name: "Master", mmr: 4800, color: 0x9b59b6 },
  { name: "Legend", mmr: 6500, color: 0xe74c3c }
];

export function getRank(mmr) {
  return [...RANKS].reverse().find(r => mmr >= r.mmr) || RANKS[0];
}

export function calcElo(score, elo, streak) {
  let gain = (score - 5.5) * 50;
  if (streak >= 3) gain *= 1.5;
  if (elo > 3500) gain *= 0.7;
  return Math.round(gain);
}

export async function applyRank(member, mmr) {
  const rank = getRank(mmr);
  let role = member.guild.roles.cache.find(r => r.name === rank.name)
    || await member.guild.roles.create({ name: rank.name, color: rank.color });

  await member.roles.add(role).catch(()=>{});
}
