# 🚀 Hackathon Assistant Bot

A robust, real-time Telegram bot designed to streamline operations during hackathons. It acts as a bridge between **Hackathon Participants (Teams)** and **Volunteers (Helpers)**, managing help requests, dynamic snack orders, and UPI payments seamlessly.

## ✨ Key Features

* **🛡️ Secure Role-Based Access:** Separate registration flows and persistent menus for Teams and Helpers.
* **🚨 Real-Time Help Desk:** Teams can request mentor/technical help. Helpers receive alerts in a dedicated group and can "Accept" and "Resolve" issues with a single click.
* **🛒 Dynamic Snack Shop & Cart:** A fully functional shopping cart system. Snack availability and prices are dynamically fetched from the database.
* **💸 Automated UPI Payments:** Generates raw `upi://` intents, web-based payment wrappers, and scannable QR codes directly in the Telegram chat for instant payments.
* **📦 Swiggy-Style Delivery Tracker:** Helpers can update order statuses (`Collecting` ➔ `On the way` ➔ `Delivered`), sending live updates to the team.
* **🏆 Volunteer Leaderboard:** Gamifies the volunteer experience by automatically tracking resolved issues and delivered orders.
* **⚙️ 64-Byte Safe Architecture:** Highly optimized inline button callbacks to prevent Telegram API loop crashes.

## 🛠️ Technology Stack

* **Node.js:** Core runtime environment.
* **Telegraf:** Telegram Bot API framework (with in-memory session management).
* **Supabase:** PostgreSQL database for real-time data storage and state persistence.
* **Express:** Lightweight web server to bind to cloud ports (ensuring 24/7 uptime).
* **QR Server API:** For dynamic UPI QR code generation.

## 🗄️ Database Schema (Supabase)

The system relies on four relational tables:
1.  `teams`: Stores team credentials and Telegram chat IDs.
2.  `helpers`: Stores volunteer profiles, UPI IDs, and leaderboard stats.
3.  `requests`: The core operational table tracking every help ticket and snack order.
4.  `snacks`: A dynamic menu table to toggle item availability on the fly.

*(SQL setup script is included in the project notes).*

## 🚀 Local Setup & Installation

**1. Clone the repository**
```bash
git clone https://github.com/AshrithVarghese/hackathena-bot.git
cd hackathon-bot
```

**2. Install dependencies**
```bash
npm install express telegraf @supabase/supabase-js dotenv
```
**3. Create Supabase DB**
```
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Teams Table
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_name TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    telegram_id BIGINT UNIQUE
);

-- 2. Helpers Table
CREATE TABLE helpers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    telegram_id BIGINT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    upi_id TEXT NOT NULL,
    help_completed INTEGER DEFAULT 0,
    orders_delivered INTEGER DEFAULT 0
);

-- 3. Requests Table (Handles both Help issues and Snack Orders)
CREATE TABLE requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT CHECK (type IN ('help', 'order')) NOT NULL,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    assigned_helper UUID REFERENCES helpers(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'pending',
    description TEXT,
    item TEXT,
    amount INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 4. Snacks Table (Dynamic Menu)
CREATE TABLE snacks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    is_available BOOLEAN DEFAULT TRUE
);

-- 5. Insert some default Hackathon Snacks to get you started!
INSERT INTO snacks (name, price, is_available) VALUES
('Coffee', 20, true),
('Sandwich', 40, true),
('Juice', 30, true),
('Red Bull', 100, true),
('Maggi', 30, true);
```

**4. Configure Environment Variables**
Create a `.env` file in the root directory and add the following:
```env
BOT_TOKEN=your_telegram_bot_token
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_service_role_key
HELP_GROUP_ID=-100XXXXXXXXXX
SHOP_GROUP_ID=-100XXXXXXXXXX
```

**5. Run the Bot**
```bash
node index.js
```

## 📱 Bot Commands

**For Teams:**
* `/register_team` - Log in with team credentials.
* `/help` - Request assistance from a volunteer.
* `/snacks` - Open the dynamic snack menu and shopping cart.

**For Helpers (Volunteers):**
* `/leaderboard` - View the top-performing volunteers.
* `/mystats` - Check your personal resolved tasks and deliveries.

## ☁️ Deployment

This bot is designed to be easily deployed on cloud platforms like **Render** or **Heroku**. It includes an Express dummy server to bind to the cloud provider's port, preventing the container from crashing. 

To keep the bot awake 24/7 on a free tier, link the deployed web URL to an [UptimeRobot](https://uptimerobot.com/) monitor pinging every 5 minutes.

---
*Built with ❤️ for Hackathons.*
