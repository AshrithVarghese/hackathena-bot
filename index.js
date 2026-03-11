import { Telegraf, Markup, session } from "telegraf";
import dotenv from "dotenv";
import { supabase } from "./supabase.js";

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const HELP_GROUP = process.env.HELP_GROUP_ID;
const SHOP_GROUP = process.env.SHOP_GROUP_ID;

// Persistent Team Keyboard
const mainMenu = Markup.keyboard([
    ['/help', '/snacks'],
    ['/register_team']
]).resize();

// Persistent Helper Keyboard
const helperMenu = Markup.keyboard([
    ['/mystats', '/leaderboard']
]).resize();

// --- UTILITY FUNCTIONS ---
const getTeam = async (id) => (await supabase.from("teams").select("*").eq("telegram_id", id).single()).data;
const getHelper = async (id) => (await supabase.from("helpers").select("*").eq("telegram_id", id).single()).data;

// Render Shopping Cart Menu
async function renderSnackMenu(ctx, isEdit = false) {
    ctx.session = ctx.session || {};
    const cart = ctx.session.cart || {};
    const snacks = ctx.session.snacksList || [];

    let totalAmt = 0;
    let cartText = "🛒 *Your Cart:*\n\n";
    let hasItems = false;

    for (const [name, details] of Object.entries(cart)) {
        if (details.qty > 0) {
            cartText += `${details.qty}x ${name} (₹${details.qty * details.price})\n`;
            totalAmt += details.qty * details.price;
            hasItems = true;
        }
    }
    
    if (!hasItems) cartText += "_Empty_\n";
    cartText += `\n*Total: ₹${totalAmt}*`;

    const buttons = snacks.map((s, index) => {
        const qty = cart[s.name]?.qty || 0;
        const label = qty > 0 ? `${s.name} (x${qty})` : s.name;
        return [Markup.button.callback(`➕ ${label} ₹${s.price}`, `add_${index}`)];
    });

    if (hasItems) {
        buttons.push([Markup.button.callback(`✅ Place Order (₹${totalAmt})`, "checkout_cart")]);
        buttons.push([Markup.button.callback("🗑 Clear Cart", "clear_cart")]);
    }

    const opts = { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) };

    if (isEdit) {
        await ctx.editMessageText(cartText, opts).catch(() => {}); 
    } else {
        await ctx.reply(cartText, opts);
    }
}

/* ================= COMMANDS ================= */

bot.start((ctx) => ctx.reply("🚀 Welcome to the Hackathon Bot!\n\nUse the menu below to get started.", mainMenu));

bot.command("register_team", (ctx) => {
    ctx.session = { step: "team_name" };
    ctx.reply("Enter your Team Name:", Markup.removeKeyboard());
});

bot.command("register_helper", (ctx) => {
    ctx.session = { step: "helper_name" };
    ctx.reply("Welcome to the Helper Registration!\n\nEnter your Name:", Markup.removeKeyboard());
});

bot.command("help", async (ctx) => {
    if (!(await getTeam(ctx.from.id))) return ctx.reply("⚠ Register your team first using /register_team", mainMenu);
    ctx.session = { step: "help_desc" };
    ctx.reply("Describe the issue you need help with:", Markup.removeKeyboard());
});

bot.command("snacks", async (ctx) => {
    if (!(await getTeam(ctx.from.id))) return ctx.reply("⚠ Register your team first using /register_team", mainMenu);

    const { data: snacks, error } = await supabase.from("snacks").select("*").eq("is_available", true);
    if (error || !snacks?.length) return ctx.reply("🛒 The snack shop is currently empty or closed.", mainMenu);

    ctx.session = ctx.session || {};
    ctx.session.cart = {}; 
    ctx.session.snacksList = snacks; 

    await renderSnackMenu(ctx, false);
});

bot.command("leaderboard", async (ctx) => {
    const { data } = await supabase.from("helpers").select("*");
    if (!data?.length) return ctx.reply("No helper data available yet.");

    const sorted = data.sort((a, b) => (b.help_completed + b.orders_delivered) - (a.help_completed + a.orders_delivered));
    let msg = "🏆 *Helper Leaderboard*\n\n" + sorted.slice(0, 10).map((h, i) => `${i + 1}. ${h.name} — ${h.help_completed + h.orders_delivered}`).join("\n");
    ctx.reply(msg, { parse_mode: "Markdown" });
});

bot.command("mystats", async (ctx) => {
    const h = await getHelper(ctx.from.id);
    if (!h) return ctx.reply("❌ You are not a registered helper.");
    ctx.reply(`📊 *${h.name}'s Stats*\n\nHelp solved: ${h.help_completed}\nOrders delivered: ${h.orders_delivered}\nTotal tasks: ${h.help_completed + h.orders_delivered}`, { parse_mode: "Markdown" });
});

/* ================= STATE MACHINE (TEXT HANDLER) ================= */

bot.on("text", async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) return next();
    const s = ctx.session;
    if (!s) return;

    const text = ctx.message.text;
    const uid = ctx.from.id;

    try {
        if (s.step === "team_name") {
            s.teamName = text;
            s.step = "team_pass";
            return ctx.reply("Enter your team password:");
        } 
        if (s.step === "team_pass") {
            const { data } = await supabase.from("teams").select("id").eq("team_name", s.teamName).eq("password", text).single();
            if (!data) { ctx.session = null; return ctx.reply("❌ Invalid credentials. Try /register_team again.", mainMenu); }
            
            await supabase.from("teams").update({ telegram_id: uid }).eq("id", data.id);
            ctx.session = null;
            return ctx.reply("✅ Team registered successfully!", mainMenu);
        }

        // --- HELPER REGISTRATION ---
        if (s.step === "helper_name") { 
            s.name = text; 
            s.step = "helper_pass"; 
            return ctx.reply("Create a password:"); 
        }
        if (s.step === "helper_pass") { 
            // We automatically pass "NA" for the upi_id so the database stays happy!
            const { error } = await supabase.from("helpers").insert({ 
                name: s.name, 
                password: text, 
                upi_id: "NA", 
                telegram_id: uid 
            });
            
            ctx.session = null;
            
            if (error) return ctx.reply("❌ Registration failed. You might already be registered.", mainMenu);
            
            await ctx.reply("✅ Helper registered successfully!", helperMenu);
            
            const helpLink = process.env.HELP_GROUP_LINK || "https://telegram.org";
            
            return ctx.reply("Welcome to the team! 🦸‍♂️\n\nPlease join the volunteer operation group below so you can start receiving tasks:\n\nNB: All the help requests will be send to the group, so you must join the group to receive tasks.", {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.url("🚨 Join Help Group", helpLink)]
                ])
            });
        }

        if (s.step === "help_desc") {
            const team = await getTeam(uid);
            const { data: req } = await supabase.from("requests").insert({ type: "help", team_id: team.id, status: "pending", description: text }).select().single();
            
            await bot.telegram.sendMessage(HELP_GROUP, `🚨 *HELP REQUEST*\n\nTeam: ${team.team_name}\nIssue: ${text}`, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([Markup.button.callback("Accept", `accept_help_${req.id}`)])
            });
            ctx.session = null;
            return ctx.reply("✅ Request sent! A volunteer will be with you shortly.", mainMenu);
        }
    } catch (err) {
        console.error("State Machine Error:", err);
        ctx.session = null;
        ctx.reply("❌ An error occurred. Please try again.", mainMenu);
    }
});

/* ================= CART ACTIONS ================= */

// Note the strict ^ and $ anchors on the regexes!
bot.action(/^add_(\d+)$/, async (ctx) => {
    if (!ctx.session?.snacksList) return ctx.answerCbQuery("⚠️ Session expired. Please send /snacks again.", { show_alert: true });
    
    const index = parseInt(ctx.match[1]);
    const snack = ctx.session.snacksList[index];
    
    ctx.session.cart = ctx.session.cart || {};
    if (!ctx.session.cart[snack.name]) ctx.session.cart[snack.name] = { qty: 0, price: snack.price };
    ctx.session.cart[snack.name].qty += 1;
    
    await renderSnackMenu(ctx, true);
    ctx.answerCbQuery(`Added 1x ${snack.name}`);
});

bot.action("clear_cart", async (ctx) => {
    if (ctx.session) ctx.session.cart = {};
    await renderSnackMenu(ctx, true);
    ctx.answerCbQuery("Cart cleared!");
});

bot.action("checkout_cart", async (ctx) => {
    if (!ctx.session?.cart) return ctx.answerCbQuery("Cart is empty!", { show_alert: true });

    let totalAmt = 0;
    let itemsArr = [];
    for (const [name, details] of Object.entries(ctx.session.cart)) {
        if (details.qty > 0) {
            itemsArr.push(`${details.qty}x ${name}`);
            totalAmt += details.qty * details.price;
        }
    }
    
    if (itemsArr.length === 0) return ctx.answerCbQuery("Cart is empty!", { show_alert: true });
    
    const itemString = itemsArr.join(", ");
    const team = await getTeam(ctx.from.id);
    
    const { data: req, error } = await supabase.from("requests").insert({ 
        type: "order", team_id: team.id, status: "pending", item: itemString, amount: totalAmt 
    }).select().single();
    
    if (error || !req) return ctx.answerCbQuery("❌ Failed to place order.", { show_alert: true });
    
    await bot.telegram.sendMessage(SHOP_GROUP, `🛒 *NEW ORDER*\n\nTeam: ${team.team_name}\nItems: ${itemString}\nTotal: ₹${totalAmt}`, {
        parse_mode: "Markdown", ...Markup.inlineKeyboard([Markup.button.callback("Accept Order", `accept_order_${req.id}`)])
    });
    
    ctx.session.cart = {}; 
    await ctx.editMessageText(`✅ *Order placed successfully!*\n\n*Items:* ${itemString}\n*Total:* ₹${totalAmt}\n\nWaiting for a helper to accept.`, { parse_mode: "Markdown" });
    await ctx.reply("Need anything else? Use the menu below.", mainMenu);
    ctx.answerCbQuery("Order placed!");
});

/* ================= HELP & ORDER ACTIONS ================= */

bot.action(/^accept_help_(.+)$/, async (ctx) => {
    const helper = await getHelper(ctx.from.id);
    if (!helper) return ctx.answerCbQuery("❌ Only helpers can accept this.", { show_alert: true });

    const { data: req } = await supabase.from("requests").update({ assigned_helper: helper.id, status: "accepted" }).eq("id", ctx.match[1]).eq("status", "pending").select("*").single();
    if (!req) return ctx.answerCbQuery("⚠️ Already taken by another helper.", { show_alert: true });

    const { data: team } = await supabase.from("teams").select("telegram_id").eq("id", req.team_id).single();

    await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n⏳ *Accepted by ${helper.name}*`, {
        parse_mode: "Markdown", ...Markup.inlineKeyboard([Markup.button.callback("Mark the Issue as Resolved", `resolve_help_${req.id}`)])
    });
    
    if (team?.telegram_id) bot.telegram.sendMessage(team.telegram_id, `✅ *${helper.name}* is coming to help you!`, { parse_mode: "Markdown" });
    ctx.answerCbQuery("Task Accepted!");
});

bot.action(/^resolve_help_(.+)$/, async (ctx) => {
    const helper = await getHelper(ctx.from.id);
    const { data: req } = await supabase.from("requests").update({ status: "resolved" }).eq("id", ctx.match[1]).eq("assigned_helper", helper?.id).select("*").single();
    if (!req) return ctx.answerCbQuery("⚠️ Unauthorized or already resolved.", { show_alert: true });

    const { data: team } = await supabase.from("teams").select("telegram_id").eq("id", req.team_id).single();

    await supabase.from("helpers").update({ help_completed: helper.help_completed + 1 }).eq("id", helper.id);
    await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n🎉 *Issue Resolved by ${helper.name}!*`, { parse_mode: "Markdown" });
    
    if (team?.telegram_id) {
        bot.telegram.sendMessage(team.telegram_id, `🎉 Your issue has been marked as resolved by *${helper.name}*!\n\nHappy to help! Continue hackathoning! 🚀`, { parse_mode: "Markdown", ...mainMenu });
    }
    bot.telegram.sendMessage(helper.telegram_id, `✅ You successfully resolved the issue! Check your updated stats below:`, helperMenu);
    ctx.answerCbQuery("Issue resolved successfully!");
});

/* --- ORDER ACCEPTANCE (Initial QR Code) --- */
bot.action(/^accept_order_(.+)$/, async (ctx) => {
    const helper = await getHelper(ctx.from.id);
    if (!helper) return ctx.answerCbQuery("❌ Only helpers can accept orders.", { show_alert: true });

    const { data: req } = await supabase.from("requests").update({ assigned_helper: helper.id, status: "payment_pending" }).eq("id", ctx.match[1]).eq("status", "pending").select("*").single();
    if (!req) return ctx.answerCbQuery("⚠️ Already taken.", { show_alert: true });

    const { data: team } = await supabase.from("teams").select("telegram_id").eq("id", req.team_id).single();

    await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n⏳ *Accepted by ${helper.name}*`, { parse_mode: "Markdown" });
    
    const rawUpi = `upi://pay?pa=${helper.upi_id}&pn=${encodeURIComponent(helper.name)}&am=${req.amount}&cu=INR`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(rawUpi)}`;
    const buttonUrl = `https://upiqr.in/api/qr?vpa=${helper.upi_id}&amount=${req.amount}&name=${encodeURIComponent(helper.name)}`;
    
    if (team?.telegram_id) {
        bot.telegram.sendPhoto(
            team.telegram_id, 
            qrUrl,
            {
                caption: `🛒 Order accepted by *${helper.name}*\n\nPlease pay ₹${req.amount} via UPI to confirm.\n\n*UPI ID:* \`${helper.upi_id}\`\n\n_Scan the QR code above or click the button below to pay._`,
                parse_mode: "Markdown", 
                ...Markup.inlineKeyboard([
                    [Markup.button.url(`💸 Pay ₹${req.amount}`, buttonUrl)],
                    [Markup.button.callback("✅ Payment Done", `paid_${req.id}`)]
                ])
            }
        );
    }
    ctx.answerCbQuery("Order Accepted!");
});

bot.action(/^paid_(.+)$/, async (ctx) => {
    const { data: req } = await supabase.from("requests").update({ status: "paid" }).eq("id", ctx.match[1]).eq("status", "payment_pending").select("*").single();
    if (!req) return ctx.answerCbQuery("⚠️ Payment already confirmed.", { show_alert: true });

    const { data: assignedHelper } = await supabase.from("helpers").select("telegram_id").eq("id", req.assigned_helper).single();

    if (assignedHelper?.telegram_id) {
        bot.telegram.sendMessage(assignedHelper.telegram_id, `💰 *Payment Received!*\n\nThe team has paid. Verify and update your delivery status:`, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("📦 Collecting Items", `stat_collecting_${req.id}`)],
                [Markup.button.callback("🏃 On the way", `stat_ontheway_${req.id}`)],
                [Markup.button.callback("✅ Delivered", `stat_delivered_${req.id}`)],
                [Markup.button.callback("❌ Payment Not Received", `stat_notpaid_${req.id}`)]
            ])
        });
    }
    
    await ctx.editMessageReplyMarkup(null); 
    ctx.reply("✅ Payment recorded. We have notified your helper!");
    ctx.answerCbQuery("Payment Confirmed!");
});

/* --- ORDER TRACKER (Handles "Not Paid" QR resending & Delivery) --- */
bot.action(/^stat_(.+)_(.+)$/, async (ctx) => {
    const [_, status, reqId] = ctx.match;
    
    const { data: req } = await supabase.from("requests").select("*").eq("id", reqId).single();
    if (req.status === "delivered") return ctx.answerCbQuery("⚠️ Order is already marked as delivered.", { show_alert: true });

    const { data: team } = await supabase.from("teams").select("telegram_id").eq("id", req.team_id).single();

    // Handle Payment Flagged
    if (status === "notpaid") {
        await supabase.from("requests").update({ status: "payment_pending" }).eq("id", reqId);
        if (team?.telegram_id) {
            const { data: helper } = await supabase.from("helpers").select("*").eq("id", req.assigned_helper).single();
            if (helper) {
                const rawUpi = `upi://pay?pa=${helper.upi_id}&pn=${encodeURIComponent(helper.name)}&am=${req.amount}&cu=INR`;
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(rawUpi)}`;
                
                bot.telegram.sendPhoto(
                    team.telegram_id, 
                    qrUrl,
                    {
                        caption: `⚠️ *Payment Not Received*\n\nYour helper (${helper.name}) reported that the payment of ₹${req.amount} has not arrived yet.\n\nPlease verify your transaction, scan the QR above, or use the button below to pay.`,
                        parse_mode: "Markdown",
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback("✅ Payment Done", `paid_${req.id}`)]
                        ])
                    }
                );
            }
        }
        await ctx.editMessageText(`❌ *Payment Flagged*\n\nYou reported the payment as not received. The team has been asked to try again.`, { parse_mode: "Markdown" });
        return ctx.answerCbQuery("Flagged as not paid.");
    }

    const statuses = { 
        collecting: "📦 *Update:* Your helper is collecting your items!", 
        ontheway: "🏃 *Update:* Your helper is on the way!", 
        delivered: `✅ *Update:* Your order has been delivered! Enjoy 🚀` 
    };
    
    await supabase.from("requests").update({ status }).eq("id", reqId);
    
    if (team?.telegram_id) {
        bot.telegram.sendMessage(team.telegram_id, statuses[status], { 
            parse_mode: "Markdown",
            ...(status === "delivered" ? mainMenu : {})
        });
    }

    if (status === "delivered") {
        const { data: helper } = await supabase.from("helpers").select("orders_delivered, telegram_id").eq("id", req.assigned_helper).single();
        if (helper) {
            await supabase.from("helpers").update({ orders_delivered: helper.orders_delivered + 1 }).eq("id", req.assigned_helper);
            await ctx.editMessageText(`✅ *Order Delivered Successfully!* Awesome work.`, { parse_mode: "Markdown" });
            bot.telegram.sendMessage(helper.telegram_id, `Ready for the next task? Check your updated stats:`, helperMenu);
        }
    }
    
    ctx.answerCbQuery(`Status updated to: ${status}`);
});

/* ================= ERROR HANDLER & START ================= */

bot.catch((err, ctx) => console.error(`[Bot Error for ${ctx.updateType}]`, err));

bot.launch().then(() => console.log("🚀 Hackathon Bot is running!"));

import express from "express";
const app = express();
app.get("/", (req, res) => res.send("Hackathon Bot is running!"));
app.listen(process.env.PORT || 3000, () => console.log("Dummy server listening on port 3000"));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));