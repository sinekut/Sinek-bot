
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { createClient } = require("@supabase/supabase-js");

const {
  DISCORD_BOT_TOKEN,
  DISCORD_APP_ID,
  DISCORD_GUILD_ID,
  DISCORD_CHANNEL_ID,
  ADMIN_ROLE_IDS,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
} = process.env;

const required = {
  DISCORD_BOT_TOKEN,
  DISCORD_APP_ID,
  DISCORD_GUILD_ID,
  DISCORD_CHANNEL_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
};

for (const [key, value] of Object.entries(required)) {
  if (!value) throw new Error(`Thieu bien moi truong: ${key}`);
}

const ADMIN_ROLES = (ADMIN_ROLE_IDS || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const commands = [
  new SlashCommandBuilder()
    .setName("donhang")
    .setDescription("Xem thong tin don hang")
    .addStringOption(o =>
      o.setName("id").setDescription("Ma don hang").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("dangxuly")
    .setDescription("Xem danh sach don dang xu ly"),

  new SlashCommandBuilder()
    .setName("hoanthanh")
    .setDescription("Danh dau don hang hoan thanh")
    .addStringOption(o =>
      o.setName("id").setDescription("Ma don hang").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("huydon")
    .setDescription("Huy don hang")
    .addStringOption(o =>
      o.setName("id").setDescription("Ma don hang").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("lydo").setDescription("Ly do huy").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("thanhtoan")
    .setDescription("Xac nhan thanh toan")
    .addStringOption(o =>
      o.setName("id").setDescription("Ma don hang").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("thongke")
    .setDescription("Thong ke don hang")
];

function isAdmin(interaction) {
  const roles = interaction.member?.roles;

  const roleIds = Array.isArray(roles)
    ? roles
    : roles?.cache?.map(role => role.id) || [];

  return (
    roleIds.some(id => ADMIN_ROLES.includes(id)) ||
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  );
}

function orderEmbed(order) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("📦 DON HANG SINEK STORE")
    .addFields(
      { name: "Ma don", value: String(order.id), inline: false },
      { name: "San pham", value: order.product_name || "Chua co", inline: true },
      { name: "Danh muc", value: order.category || "Chua co", inline: true },
      { name: "So luong", value: String(order.quantity || 1), inline: true },
      {
        name: "Tong tien",
        value: `${Number(order.total_vnd || 0).toLocaleString("vi-VN")}d`,
        inline: true
      },
      { name: "Trang thai", value: order.status || "pending", inline: true },
      { name: "Thanh toan", value: order.payment_status || "unpaid", inline: true },
      { name: "Ten game", value: order.game_name || "Khong co", inline: true },
      { name: "Thong tin", value: order.details || "Khong co", inline: false }
    )
    .setTimestamp()
    .setFooter({ text: "Sinek Store • Sinek Bot" });
}

async function notify(title, order) {
  try {
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) return;

    await channel.send({
      content: title,
      embeds: [orderEmbed(order)]
    });
  } catch (error) {
    console.error("Loi gui thong bao:", error.message);
  }
}

async function getOrder(id) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function updateOrder(id, changes) {
  const { data, error } = await supabase
    .from("orders")
    .update(changes)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(DISCORD_APP_ID, DISCORD_GUILD_ID),
    { body: commands.map(c => c.toJSON()) }
  );

  console.log("Da dang ky lenh Discord!");
}

client.once("ready", async () => {
  console.log(`Sinek Bot da online: ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Loi dang ky lenh:", error.message);
  }

  supabase
    .channel("sinek-orders")
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "orders"
    }, payload => {
      notify("🆕 CO DON HANG MOI!", payload.new);
    })
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "orders"
    }, payload => {
      const oldOrder = payload.old || {};
      const newOrder = payload.new || {};

      if (oldOrder.status !== newOrder.status) {
        notify("🔔 TRANG THAI DON HANG DA THAY DOI!", newOrder);
      }

      if (oldOrder.payment_status !== newOrder.payment_status) {
        notify("💰 THANH TOAN DA THAY DOI!", newOrder);
      }
    })
    .subscribe();
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const name = interaction.commandName;

    if (!isAdmin(interaction)) {
      return interaction.reply({
        content: "❌ Ban khong co quyen su dung lenh nay!",
        ephemeral: true
      });
    }

    if (name === "donhang") {
      const order = await getOrder(interaction.options.getString("id"));

      if (!order) {
        return interaction.reply({
          content: "Khong tim thay don hang!",
          ephemeral: true
        });
      }

      return interaction.reply({
        embeds: [orderEmbed(order)],
        ephemeral: true
      });
    }

    if (name === "dangxuly") {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;

      return interaction.reply({
        content: data.length ? `Co ${data.length} don hang:` : "Khong co don dang xu ly.",
        embeds: data.slice(0, 10).map(orderEmbed),
        ephemeral: true
      });
    }

    if (["hoanthanh", "huydon", "thanhtoan"].includes(name)) {
      const id = interaction.options.getString("id");
      const order = await getOrder(id);

      if (!order) {
        return interaction.reply({
          content: "Khong tim thay don hang!",
          ephemeral: true
        });
      }

      let changes = {};
      let message = "";

      if (name === "hoanthanh") {
        changes = { status: "completed" };
        message = "Da hoan thanh don hang!";
      }

      if (name === "huydon") {
        changes = { status: "cancelled" };
        const reason = interaction.options.getString("lydo");
        if (reason) changes.admin_note = reason;
        message = "Da huy don hang!";
      }

      if (name === "thanhtoan") {
        changes = { payment_status: "paid" };
        message = "Da xac nhan thanh toan!";
      }

      const updated = await updateOrder(id, changes);

      return interaction.reply({
        content: message,
        embeds: [orderEmbed(updated)],
        ephemeral: true
      });
    }

    if (name === "thongke") {
      const { data, error } = await supabase
        .from("orders")
        .select("status,total_vnd,payment_status");

      if (error) throw error;

      const revenue = data
        .filter(x => x.payment_status === "paid")
        .reduce((sum, x) => sum + Number(x.total_vnd || 0), 0);

      const counts = status =>
        data.filter(x => x.status === status).length;

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("📊 THONG KE SINEK STORE")
        .addFields(
          { name: "Tong don", value: String(data.length), inline: true },
          { name: "Cho xu ly", value: String(counts("pending")), inline: true },
          { name: "Dang xu ly", value: String(counts("processing")), inline: true },
          { name: "Hoan thanh", value: String(counts("completed")), inline: true },
          { name: "Da huy", value: String(counts("cancelled")), inline: true },
          {
            name: "Doanh thu da thanh toan",
            value: `${revenue.toLocaleString("vi-VN")}d`
          }
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (error) {
    console.error(error);

    const message = "Co loi xay ra: " + error.message;

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
