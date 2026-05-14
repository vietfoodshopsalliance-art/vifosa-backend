/**
 * Seed dữ liệu mặc định cho collection `settings`
 * Chạy 1 lần lúc khởi tạo DB (upsert safe)
 * Tương ứng với bảng cấu hình mục 5.5.4 trong spec v3.1
 */

export const DEFAULT_SETTINGS = [
  { key: 'home_feed_per_group', value: 2, description: 'Số quán mỗi nhóm trang chủ' },
  { key: 'home_default_radius_km', value: 5, description: 'Default radius khách thấy (km)' },
  { key: 'ship_fee_default_a', value: 12000, description: 'Phí ship cố định mặc định (VND)' },
  { key: 'ship_fee_default_b', value: 5000, description: 'Đơn giá/km (VND)' },
  { key: 'ship_fee_default_c', value: 0, description: 'Phần trăm cao điểm (%)' },
  { key: 'service_radius_max_km', value: 25, description: 'Bán kính tối đa cho phép đặt (km)' },
  { key: 'service_radius_warn_km', value: 10, description: 'Ngưỡng cảnh báo khoảng cách xa (km)' },
  { key: 'auto_cancel_pending_min', value: 15, description: 'Phút auto-cancel đơn quán không nhận' },
  { key: 'auto_cancel_payment_min', value: 10, description: 'Phút auto-cancel sau "tiền chưa vào TK"' },
  { key: 'auto_complete_after_delivered_h', value: 3, description: 'Giờ auto-complete sau delivered' },
  { key: 'ttl_preparing_alert_h', value: 3, description: 'Giờ alert TTL đơn đang chuẩn bị' },
  { key: 'auto_refunded_after_h', value: 48, description: 'Giờ auto-refunded nếu khách không phản hồi' },
  { key: 'pre_order_no_action_h', value: 2, description: 'Giờ pre-order chưa nhận sau giờ mở → cancel' },
  { key: 'commission_tier_500', value: 0.01, description: 'Phí % bậc 1 (≥500 đơn/tháng)' },
  { key: 'commission_tier_1000', value: 0.03, description: 'Phí % bậc 2 (≥1000 đơn/tháng)' },
  { key: 'commission_tier_5000', value: 0.05, description: 'Phí % bậc 3 (≥5000 đơn/tháng)' },
  { key: 'commission_enabled', value: false, description: 'Bật tính phí hoa hồng (false trong MVP)' },
  { key: 'guest_orders_enabled', value: true, description: 'Cho phép khách vãng lai đặt hàng' },
  { key: 'vip_purchase_visible', value: false, description: 'Hiện nút mua VIP cho quán' },
]
