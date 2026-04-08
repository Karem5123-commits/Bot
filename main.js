import discord
import os
import asyncio
from discord.ext import commands

intents = discord.Intents.default()
intents.guilds = True
intents.members = True  # Needed for auto-role assignment
intents.message_content = True

bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_ready():
    print(f'🚀 {bot.user.name} is online and ready to build.')

@bot.command()
@commands.has_permissions(administrator=True)
async def build(ctx):
    """The Ultimate Server Build Command"""
    guild = ctx.guild
    
    # 1. CLEANUP (Optional: Deletes old channels/roles to start fresh)
    await ctx.send("🧹 Cleaning up existing layout...")
    for channel in guild.channels:
        try: await channel.delete()
        except: pass

    # 2. CREATE ROLES (With proper hierarchy and colors)
    await ctx.send("🎭 Creating professional role hierarchy...")
    
    # Staff Roles
    admin_role = await guild.create_role(name="OWNER", colour=discord.Colour.from_rgb(255, 0, 0), hoist=True, permissions=discord.Permissions(administrator=True))
    mod_role = await guild.create_role(name="STAFF", colour=discord.Colour.blue(), hoist=True)
    
    # Tier Roles (Visual Only - No Perms)
    tier_data = [
        ("SSS", discord.Colour.from_rgb(255, 215, 0)),
        ("WORLD CLASS", discord.Colour.from_rgb(255, 100, 255)),
        ("LEGENDARY", discord.Colour.from_rgb(150, 0, 255)),
        ("EPIC", discord.Colour.from_rgb(0, 200, 255)),
        ("RARE", discord.Colour.from_rgb(50, 255, 50)),
        ("COMMON", discord.Colour.light_grey())
    ]
    
    roles = {}
    for name, color in tier_data:
        role = await guild.create_role(name=name, colour=color, hoist=True)
        roles[name] = role

    # 3. PERMISSION OVERWRITES
    # Setup standard 'Read Only' for info channels
    readonly = {
        guild.default_role: discord.PermissionOverwrite(send_messages=False, view_channel=True),
        admin_role: discord.PermissionOverwrite(send_messages=True, view_channel=True)
    }

    # 4. DESIGNING CATEGORIES & CHANNELS
    # --- INFORMATION ---
    cat_info = await guild.create_category("『 ɪɴꜰᴏʀᴍᴀᴛɪᴏɴ 』", overwrites=readonly)
    await guild.create_text_channel("┃rules", category=cat_info)
    await guild.create_text_channel("┃announcements", category=cat_info)
    await guild.create_text_channel("┃roles", category=cat_info)

    # --- CHAT PLAZA ---
    cat_chat = await guild.create_category("『 ᴄᴏᴍᴍᴜɴɪᴛʏ 』")
    await guild.create_text_channel("┃general-chat", category=cat_chat)
    await guild.create_text_channel("┃media-only", category=cat_chat)
    await guild.create_text_channel("┃bot-commands", category=cat_chat)

    # --- TIER ZONE (SSS Only) ---
    sss_only = {
        guild.default_role: discord.PermissionOverwrite(view_channel=False),
        roles["SSS"]: discord.PermissionOverwrite(view_channel=True),
        admin_role: discord.PermissionOverwrite(view_channel=True)
    }
    cat_sss = await guild.create_category("『 ꜱꜱꜱ ᴇxᴄʟᴜꜱɪᴠᴇ 』", overwrites=sss_only)
    await guild.create_text_channel("┃sss-lounge", category=cat_sss)
    await guild.create_voice_channel("┃SSS VC", category=cat_sss)

    # --- VOICE LOUNGE ---
    cat_vc = await guild.create_category("『 ᴠᴏɪᴄᴇ ᴄʜᴀɴɴᴇʟꜱ 』")
    await guild.create_voice_channel("┃Lounge", category=cat_vc)
    await guild.create_voice_channel("┃Gaming", category=cat_vc)

    # 5. AUTO-WELCOME SYSTEM
    welcome_channel = await guild.create_text_channel("┃welcome", category=cat_info)
    
    await ctx.author.send(f"✅ **{guild.name}** has been fully optimized and styled!")

# AUTO-ROLE ON JOIN
@bot.event
async def on_member_join(member):
    # Automatically give 'COMMON' role to new joins
    role = discord.utils.get(member.guild.roles, name="COMMON")
    if role:
        await member.add_roles(role)

bot.run(os.environ.get('DISCORD_TOKEN'))
