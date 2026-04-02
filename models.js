import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  username: String,
  elo: { type: Number, default: 1000 },
  streak: { type: Number, default: 0 },
  peakElo: { type: Number, default: 1000 },
  stats: {
    enhanced: { type: Number, default: 0 },
    subs: { type: Number, default: 0 }
  }
}, { timestamps: true });

const GuildConfigSchema = new mongoose.Schema({
  guildId: { type: String, unique: true, required: true },
  rankRoles: { type: Map, of: String, default: {} }
}, { timestamps: true });

export const User = mongoose.model("User", UserSchema);
export const GuildConfig = mongoose.model("GuildConfig", GuildConfigSchema);
