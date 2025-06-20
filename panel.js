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
      .lte("end", in24h.toISO())
      .order("start", { ascending: true });
  
    if (error) {
      console.error("❌ Failed to fetch events:", error);
      return [];
    }
  
    console.log("📅 Events in next 24 hours:", data);
    return data;
  }
  
  async function fetchBookingsForEvents(eventUUIDs = []) {
    if (!eventUUIDs.length) return [];
  
    const { data, error } = await window.supabase
      .from("bookings")
      .select("uuid, event_id, details, user_id, transaction_id, entry_code, checkout_completed")
      .overlaps("event_id", eventUUIDs); // array overlap match
  
    if (error) {
      console.error("❌ Failed to fetch bookings for events:", error);
      return [];
    }
  
    console.log("📦 Bookings linked to events:", data);
    return data;
}

function renderCurrentBooking(bookingDetails, bookingUUID, event) {
    if (!bookingDetails) return;
  
    const start = DateTime.fromISO(bookingDetails.start, { zone: TIMEZONE });
    const end = DateTime.fromISO(bookingDetails.end, { zone: TIMEZONE });
    const user = bookingDetails.user || {};
    const listing = bookingDetails.listing || {};
  
    document.getElementById("guest-name").textContent = `${user.first_name || ""} ${user.last_name || ""}`;
    document.getElementById("start").textContent = `${start.toFormat("h:mm a")}`;
    document.getElementById("end").textContent = `${end.toFormat("h:mm a")}`;
    document.getElementById("listing-name").textContent = listing.name || "—";
}
  
async function refreshBookingData() {
    console.log("🔄 Refreshing booking data...");
  
    const events = await fetchUpcomingEvents();
    const eventUUIDs = events.map(e => e.uuid);
    const bookings = await fetchBookingsForEvents(eventUUIDs);
  
    const enrichedEvents = events.map(event => {
        const booking = bookings.find(b => Array.isArray(b.event_id) && b.event_id.includes(event.uuid));
        return {
            ...event,
            bookingDetails: booking?.details || null,
            bookingUUID: booking?.uuid || null
        };
    });
  
    const sidePanel = document.querySelector(".side-col-wrapper");
  
    const now = DateTime.now().setZone(TIMEZONE);
    const activeEvent = enrichedEvents.find(e =>
        DateTime.fromISO(e.start) <= now && DateTime.fromISO(e.end) >= now
    );
  
    if (activeEvent && activeEvent.bookingDetails) {
        window.currentBooking = activeEvent.bookingDetails;
        renderCurrentBooking(activeEvent.bookingDetails, activeEvent.bookingUUID, activeEvent);
        sidePanel?.classList.remove("hide");
    } else {
        console.log("🕒 No active booking at the moment");
        sidePanel?.classList.add("hide");
    }
}

function scheduleQuarterHourUpdates(callback) {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const msUntilNextQuarter = ((15 - (minutes % 15)) % 15) * 60 * 1000 - seconds * 1000;
  
    setTimeout(() => {
        callback(); // initial trigger at next quarter
        setInterval(callback, 15 * 60 * 1000); // every 15 minutes thereafter
    }, msUntilNextQuarter);
}
  

// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🟢 Studio control panel script loaded");
    const events = await fetchUpcomingEvents();
    const eventUUIDs = events.map(e => e.uuid);
    const bookings = await fetchBookingsForEvents(eventUUIDs);

    const enrichedEvents = events.map(event => {
        const booking = bookings.find(b => Array.isArray(b.event_id) && b.event_id.includes(event.uuid));
        return {
            ...event,
            bookingDetails: booking?.details || null,
            bookingUUID: booking?.uuid || null
        };
    });

    console.log("🔗 Matched events with bookings:", enrichedEvents);

    const sidePanel = document.querySelector(".side-col-wrapper");

    const activeEvent = enrichedEvents.find(e => {
        const now = DateTime.now().setZone(TIMEZONE);
        return DateTime.fromISO(e.start) <= now && DateTime.fromISO(e.end) >= now;
    });

    if (activeEvent && activeEvent.bookingDetails) {
        window.currentBooking = activeEvent.bookingDetails;
        renderCurrentBooking(activeEvent.bookingDetails, activeEvent.bookingUUID, activeEvent);
        sidePanel?.classList.remove("hide");
    } else {
        console.log("🕒 No active booking at the moment");
        sidePanel?.classList.add("hide");
    }

  });
  