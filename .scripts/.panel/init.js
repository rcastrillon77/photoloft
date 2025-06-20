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

    const activeEvent = enrichedEvents.find(e => {
        const now = DateTime.now().setZone(TIMEZONE);
        return DateTime.fromISO(e.start) <= now && DateTime.fromISO(e.end) >= now;
    });
      
    if (activeEvent && activeEvent.bookingDetails) {
        window.currentBooking = activeEvent.bookingDetails;
        renderCurrentBooking(activeEvent.bookingDetails, activeEvent.bookingUUID, activeEvent);
    } else {
        console.log("🕒 No active booking at the moment");
    } 
      

  });
  