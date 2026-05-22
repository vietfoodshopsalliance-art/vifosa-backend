import { Server } from 'socket.io'

let _io: Server | null = null

export function setSocketIO(io: Server) {
  _io = io
}

export function emitOrderStatus(orderId: string, status: string) {
  if (!_io) return
  _io.to(`order:${orderId}`).emit('order_status_changed', { orderId, status })
}

export function emitPaymentStatus(orderId: string, paymentStatus: string) {
  if (!_io) return
  _io.to(`order:${orderId}`).emit('payment_status_changed', { orderId, paymentStatus })
}

export function emitOrderNew(storeId: string, order: any) {
  if (!_io) return
  _io.to(`store:${storeId}`).emit('new_order', order)
}

export function emitOrderUpdated(storeId: string, order: any) {
  if (!_io) return
  _io.to(`store:${storeId}`).emit('order:updated', order)
}
