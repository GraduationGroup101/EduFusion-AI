const ownerKey = (user) => user.id_student !== undefined && user.id_student !== null
  ? `student:${user.id_student}` : `user:${user.id}`;
module.exports = { ownerKey };
