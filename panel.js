// =======================
// CONSTANTS
// =======================
const { DateTime } = luxon;

const LOCATION_UUID = "9e92e73f-4f4a-4252-8d56-ebd8e74772f1";
const TIMEZONE = "America/Chicago";


// =======================
// FUNCTIONS
// =======================

// GET EVENTS
async function fetchUpcomingEvents() {
    const now = DateTime.now().setZone(TIMEZONE).minus({ minutes: 30 });
    const in24h = DateTime.now().setZone(TIMEZONE).plus({ hours: 24 });
  
    const { data, error } = await window.supabase
      .from("events")
      .select("uuid, start, end, location_id, listing_id")
      .eq("location_id", LOCATION_UUID)
      .eq("type", "booking")
      .eq("status", "confirmed")
      .gte("end", now.toISO())
      .lte("end", tomorrow.toISO())
      .order("start", { ascending: true });
  
    if (error) {
      console.error("❌ Failed to fetch events:", error);
      return [];
    }
  
    console.log("📅 Events in next 24 hours:", data);
    return data;
  }
  

// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🟢 Studio control panel script loaded");
    await fetchUpcomingEvents();
  });
  