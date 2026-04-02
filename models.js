import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    userId: { type: String, unique: true, index: true },
    username: String,
    elo: { type: Number, default: 1000 },
    rank: { type: String, default: "Bronze" },
    xp: { type: Number, default: 0 },
    stats: {
        totalSubmissions: { type: Number, default: 0 },
        accepted: { type: Number, default: 0 },
        enhanced: { type: Number, default: 0 }
    },
    infractions: [{ type: String, reason: String, date: { type: Date, default: Date.now } }]
});

export const User = mongoose.model('User', UserSchema);
