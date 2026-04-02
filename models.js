import mongoose from "mongoose";

export const User = mongoose.model("User", new mongoose.Schema({
  userId: String,
  elo: { type: Number, default: 1000 }
}));

export const Guild = mongoose.model("Guild", new mongoose.Schema({
  guildId: String
}));

export const Job = mongoose.model("Job", new mongoose.Schema({
  userId: String,
  url: String,
  status: String,
  result: String
}));
