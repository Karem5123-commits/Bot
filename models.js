import mongoose from "mongoose";

// --- USER SCHEMA (RANKING SYSTEM) ---
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: { type: String },

  elo: { type: Number, default: 1000 },
  peakElo: { type: Number, default: 1000 },
  streak: { type: Number, default: 0 },

  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },

  lastSubmit: { type: Date }
}, { timestamps: true });


// --- GUILD CONFIG (ROLES SYSTEM) ---
const guildConfigSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },

  rankRoles: {
    type: Map,
    of: String,
    default: {}
  }
});


// ✅ EXPORT BOTH (THIS IS WHAT WAS BROKEN)
export const User = mongoose.model("User", userSchema);
export const GuildConfig = mongoose.model("GuildConfig", guildConfigSchema);
