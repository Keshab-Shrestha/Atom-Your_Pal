#include "AtomPTY.h"
#include <util.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <errno.h>
#include <libproc.h>
#include <sys/wait.h>

pid_t atom_pty_spawn(const char *cwd, char *const argv[], char *const env[], struct winsize *size, int *master) {
    int errors[2];
    if (pipe(errors) != 0) return -1;
    fcntl(errors[0], F_SETFD, FD_CLOEXEC);
    fcntl(errors[1], F_SETFD, FD_CLOEXEC);
    int descriptor_limit = getdtablesize();
    pid_t child = forkpty(master, NULL, NULL, size);
    if (child == 0) {
        close(errors[0]);
        // Preserve only the error channel and terminal stdio; never inherit the app/runtime's open FDs.
        if (errors[1] != 3) { dup2(errors[1], 3); }
        fcntl(3, F_SETFD, FD_CLOEXEC);
        for (int fd = 4; fd < descriptor_limit; fd++) close(fd);
        sigset_t empty;
        sigemptyset(&empty); sigprocmask(SIG_SETMASK, &empty, NULL);
        struct sigaction action = {0}; action.sa_handler = SIG_DFL; sigemptyset(&action.sa_mask);
        for (int sig = 1; sig < NSIG; sig++) if (sig != SIGKILL && sig != SIGSTOP) sigaction(sig, &action, NULL);
        if (chdir(cwd) == 0) execve("/bin/zsh", argv, env);
        int failure = errno;
        (void)write(3, &failure, sizeof(failure));
        _exit(127);
    }
    close(errors[1]);
    if (child < 0) { close(errors[0]); return -1; }
    int failure = 0;
    ssize_t count;
    do { count = read(errors[0], &failure, sizeof(failure)); } while (count < 0 && errno == EINTR);
    close(errors[0]);
    if (count > 0) {
        close(*master); *master = -1;
        while (waitpid(child, NULL, 0) < 0 && errno == EINTR) {}
        errno = failure;
        return -1;
    }
    fcntl(*master, F_SETFD, FD_CLOEXEC);
    fcntl(*master, F_SETFL, fcntl(*master, F_GETFL) | O_NONBLOCK);
    return child;
}

int atom_pty_resize(int master, struct winsize *size) { return ioctl(master, TIOCSWINSZ, size); }

void atom_pty_stop_session(pid_t shell) {
    if (shell <= 1 || shell == getpid()) return;
    // Keep the session leader unreaped while enumerating, so its session ID cannot be reused.
    kill(shell, SIGSTOP);
    int bytes = proc_listpids(PROC_ALL_PIDS, 0, NULL, 0);
    if (bytes > 0) {
        int capacity = bytes + 4096 * (int)sizeof(pid_t);
        pid_t *pids = calloc(1, capacity);
        if (pids) {
            int count = proc_listpids(PROC_ALL_PIDS, 0, pids, capacity) / (int)sizeof(pid_t);
            // Freeze jobs before killing them: their parents cannot reap/reuse their IDs in between.
            for (int i = 0; i < count; i++) {
                pid_t pid = pids[i];
                if (pid > 1 && pid != shell && getsid(pid) == shell) kill(pid, SIGSTOP);
                else pids[i] = 0;
            }
            for (int i = 0; i < count; i++) if (pids[i] > 1 && getsid(pids[i]) == shell) kill(pids[i], SIGKILL);
            free(pids);
        }
    }
    kill(-shell, SIGKILL);
    kill(shell, SIGKILL);
}
