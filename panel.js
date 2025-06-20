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
    const now = DateTime.now().setZone(TIMEZONE);
    const tomorrow = now.plus({ hours: 24 });
  
    const { data, error } = await window.supabase
      .from("events")
      .select("uuid, start, end, booking_id, location_id")
      .eq("location_id", LOCATION_UUID)
      .gte("start", now.toISO())
      .lte("start", tomorrow.toISO())
      .order("start", { ascending: true });
  
    if (error) {
      console.error("❌ Failed to fetch events:", error);
      return [];
    }
  
    console.log("📅 Events in next 24 hours:", data);
    return data;
  }
  

const hello = true;