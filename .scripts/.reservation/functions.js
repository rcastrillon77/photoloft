async function rebuildBookingDetails(bookingUuid) {
  const { data: bookingData, error } = await supabase
  .from("bookings")
  .select("*")
  .eq("uuid", bookingUuid)
  .maybeSingle();

if (error || !bookingData) {
  console.error("❌ Booking not found or error:", error);
  return;
}

const [user, transaction, events, locations] = await Promise.all([
  supabase.from("users").select("*").eq("uuid", bookingData.user_id).maybeSingle(),
  supabase.from("transactions").select("*").eq("uuid", bookingData.transaction_id).maybeSingle(),
  supabase.from("events").select("*").in("uuid", bookingData.event_id).then(res => res.data || []),
  supabase.from("locations").select("*").in("uuid", bookingData.location_id).then(res => res.data || [])
]);

if (!user.data) console.warn("⚠️ User not found");
if (!transaction.data) console.warn("⚠️ Transaction not found");
if (!events.length) console.warn("⚠️ No events found");
if (!locations.length) console.warn("⚠️ No locations found");



  const details = {
    start: data.events?.start || null,
    end: data.events?.end || null,
    duration: data.events?.duration || null,
    attendees: data.details?.attendees || null,
    user: {
      first_name: data.users?.first_name || "",
      last_name: data.users?.last_name || "",
      email: data.users?.email || "",
      phone: data.users?.phone || "",
      membership: data.users?.membership || "guest"
    },
    listing: {
      name: data.details?.listing?.name || "",
      city: data.details?.listing?.city || "",
      state: data.details?.listing?.state || "",
      timezone: data.details?.listing?.timezone || "",
      zip_code: data.details?.listing?.zip_code || "",
      address_line_1: data.details?.listing?.address_line_1 || "",
      address_line_2: data.details?.listing?.address_line_2 || "",
      coordinates: data.details?.listing?.coordinates || {}
    },
    activities: data.details?.activities || [],
    transaction: {
      subtotal: data.transactions?.subtotal || 0,
      total: data.transactions?.total || 0,
      tax_rate: data.transactions?.tax_rate || 0,
      tax_total: data.transactions?.taxes_total || 0,
      discount_total: data.transactions?.discount_total || 0,
      base_rate: data.transactions?.base_rate || 0,
      final_rate: data.transactions?.final_rate || 0,
      rate_label: data.transactions?.rate_label || "",
      user_credits_applied: data.transactions?.user_credits_applied || 0,
      discounts: data.transactions?.discounts || []
    }
  };

  const { error: updateError } = await window.supabase
    .from("bookings")
    .update({ details })
    .eq("uuid", bookingUuid);

  if (updateError) {
    console.error("❌ Failed to update booking details:", updateError);
    return false;
  }

  console.log("✅ Booking details updated.");
  return true;
}
