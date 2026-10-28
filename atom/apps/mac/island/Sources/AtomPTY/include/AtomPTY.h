#include <sys/types.h>
#include <sys/ioctl.h>

// All allocations happen before fork. The child only uses async-signal-safe POSIX calls.
pid_t atom_pty_spawn(const char *cwd, char *const argv[], char *const env[], struct winsize *size, int *master);
int atom_pty_resize(int master, struct winsize *size);
// Call while the owning shell is still unreaped. Deliberately detached sessions are outside this lifetime.
void atom_pty_stop_session(pid_t shell);
