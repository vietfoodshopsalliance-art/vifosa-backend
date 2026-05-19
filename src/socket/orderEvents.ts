import { Server } from 'socket.io'

let _io: Server | null = null

export function setSocketIO(io: Server) {
  _io = io
}

export function emitOrderStatus(orderId: string, status: string) {
  if (!_io) return
  _io.to(`order:${orderId}`).emit('order:status', { orderId, status })
}

export function emitOrderNew(storeId: string, order: any) {
  if (!_io) return
  _io.to(`store:${storeId}`).emit('order:new', order)
}

export function emitOrderUpdated(storeId: string, order: any) {
  if (!_io) return
  _io.to(`store:${storeId}`).emit('order:updated', order)
}
