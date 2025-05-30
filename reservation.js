const hello = "hello world";



(async function initReservationPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const bookingId = urlParams.get("booking");
  
    if (!bookingId) {
      console.warn("⚠️ No booking ID in URL.");
      return;
    }
  
    const success = await fetchBookingDetails(bookingId);
    /*
    if (!success) return;
  
    const allowedMemberships = ["free-members", "paid-members"];
    const userIsAllowed = allowedMemberships.includes(window.bookingDetails.membership);
  
    if (!userIsAllowed && !window.supabaseUser?.id) {
      alert("🔐 Please log in to view this booking.");
      // TODO: redirect or show login prompt
      return;
    }
    */
  
    console.log("📦 Loaded bookingDetails:", window.bookingDetails);
    // TODO: Show booking info in UI

    populateBookingDetailsUI();
  })();
  